"""Background scheduler: recurring jobs, due-date reminders, nightly backups.

Runs on a daemon thread inside the single gunicorn worker; every tick is
wrapped so one bad rule can never kill the loop."""
import os
import shutil
import sqlite3
import threading
import time
import zipfile
from datetime import date, datetime, timedelta

from .config import DATA_DIR, UPLOAD_DIR
from .db import db

TICK_SECONDS = 300         # check every 5 minutes
BACKUP_KEEP = 14           # keep two weeks of nightly backups
BACKUP_DIR = os.path.join(DATA_DIR, 'backups')

_started = False


def start_scheduler(app):
    global _started
    if _started:
        return
    _started = True

    def loop():
        time.sleep(20)  # let the app finish booting/migrating first
        while True:
            try:
                with app.app_context():
                    run_recurring()
            except Exception as e:  # noqa: BLE001
                print(f'TaskMaster scheduler (recurring): {e}')
            try:
                with app.app_context():
                    run_daily_once()
            except Exception as e:  # noqa: BLE001
                print(f'TaskMaster scheduler (daily): {e}')
            time.sleep(TICK_SECONDS)

    threading.Thread(target=loop, daemon=True, name='tm-scheduler').start()


def compute_next_run(frequency, weekday, monthday, after=None):
    """Next 06:00 occurrence of the schedule, strictly after `after`."""
    after = after or datetime.utcnow()
    day = after.date()
    for _ in range(0, 62):
        day = day + timedelta(days=1)
        if frequency == 'daily':
            break
        if frequency == 'weekly' and day.weekday() == int(weekday or 0):
            break
        if frequency == 'monthly' and day.day == int(monthday or 1):
            break
    return datetime.combine(day, datetime.min.time()) + timedelta(hours=6)


def run_recurring():
    from .models import Board, RecurringJob
    from .services import broadcast_board
    now = datetime.utcnow()
    due = RecurringJob.query.filter(RecurringJob.enabled.is_(True),
                                    RecurringJob.next_run_at <= now).all()
    for rule in due:
        board = db.session.get(Board, rule.board_id)
        if board is None:
            db.session.delete(rule)
            continue
        _create_recurring_item(rule, board)
        rule.last_run_at = now
        rule.next_run_at = compute_next_run(rule.frequency, rule.weekday,
                                            rule.monthday, now)
        db.session.commit()
        broadcast_board(board.id)
        print(f'TaskMaster: recurring job "{rule.name}" created on "{board.name}"')


def _create_recurring_item(rule, board):
    import json
    from .models import BoardColumn, BoardGroup, Item, ItemValue, JobTemplate, User
    from .services import apply_template, log_activity, notify_user
    group = (BoardGroup.query.filter_by(board_id=board.id)
             .order_by(BoardGroup.position).first())
    if group is None:
        return
    max_pos = (db.session.query(db.func.max(Item.position))
               .filter_by(group_id=group.id).scalar() or 0)
    item = Item(board_id=board.id, group_id=group.id, name=rule.name,
                position=max_pos + 1, created_by=rule.created_by)
    db.session.add(item)
    db.session.flush()
    creator = db.session.get(User, rule.created_by) if rule.created_by else None
    template = db.session.get(JobTemplate, rule.template_id) if rule.template_id else None
    if template and creator:
        apply_template(creator, board, item, template, log=False)
    log_activity(rule.created_by, board.id, item.id, 'item_created',
                 f'created "{rule.name}" automatically (recurring)')
    if rule.assignee_id:
        people = (BoardColumn.query.filter_by(board_id=board.id, type='people')
                  .order_by(BoardColumn.position).first())
        if people:
            existing = ItemValue.query.filter_by(item_id=item.id, column_id=people.id).first()
            ids = set((existing.value_dict().get('user_ids') if existing else None) or [])
            ids.add(rule.assignee_id)
            payload = json.dumps({'user_ids': sorted(ids)})
            if existing:
                existing.value = payload
            else:
                db.session.add(ItemValue(item_id=item.id, column_id=people.id, value=payload))
        notify_user(rule.assignee_id, None, 'assigned', board.id, item.id,
                    f'Recurring job "{rule.name}" is ready on {board.name}')


def run_daily_once():
    """Reminders + backup, once per (UTC) day."""
    from .models import AppSetting
    today = date.today().isoformat()
    if AppSetting.get_json('daily_jobs_last_run') == today:
        return
    AppSetting.set_json('daily_jobs_last_run', today)
    db.session.commit()
    try:
        run_due_reminders()
    except Exception as e:  # noqa: BLE001
        print(f'TaskMaster reminders: {e}')
    try:
        run_backup()
    except Exception as e:  # noqa: BLE001
        print(f'TaskMaster backup: {e}')
    try:
        from .services import purge_old_trash
        n = purge_old_trash()
        if n:
            print(f'TaskMaster trash: purged {n} entries older than 30 days')
    except Exception as e:  # noqa: BLE001
        print(f'TaskMaster trash purge: {e}')


def run_due_reminders():
    """Tell assignees about jobs due tomorrow, due today, and overdue."""
    from .models import Board, BoardColumn, Item, ItemValue
    from .services import notify_user
    today = date.today()
    date_cols = {c.id: c for c in BoardColumn.query.filter_by(type='date').all()}
    if not date_cols:
        return
    status_cols = {}
    done_ids = {}
    for c in BoardColumn.query.filter_by(type='status').all():
        status_cols[c.board_id] = c.id
        done_ids[c.id] = {l['id'] for l in c.settings_dict().get('labels', [])
                          if l.get('label', '').strip().lower() == 'done'}
    boards = {b.id: b for b in Board.query.filter_by(archived=False).all()}

    for v in ItemValue.query.filter(ItemValue.column_id.in_(list(date_cols))).all():
        d = v.value_dict().get('date')
        if not d:
            continue
        try:
            due = date.fromisoformat(d)
        except ValueError:
            continue
        delta = (due - today).days
        if delta > 1 or delta < -30:
            continue
        item = db.session.get(Item, v.item_id)
        if item is None or item.board_id not in boards:
            continue
        # skip jobs already done
        scol = status_cols.get(item.board_id)
        if scol:
            sval = ItemValue.query.filter_by(item_id=item.id, column_id=scol).first()
            if sval and sval.value_dict().get('id') in done_ids.get(scol, set()):
                continue
        board = boards[item.board_id]
        if delta == 1:
            msg = f'"{item.name}" on {board.name} is due tomorrow'
        elif delta == 0:
            msg = f'"{item.name}" on {board.name} is due today'
        else:
            msg = f'"{item.name}" on {board.name} is overdue ({-delta} day{"s" if delta != -1 else ""})'
        from .services import people_column_user_ids, run_automations
        for uid in people_column_user_ids(item.id):
            notify_user(uid, None, 'status', item.board_id, item.id, msg)
        if delta < 0:
            run_automations('overdue', board, item, None)
    db.session.commit()


def run_backup():
    """Zip the database (consistent sqlite snapshot) + uploads; keep the last N."""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = date.today().isoformat()
    target = os.path.join(BACKUP_DIR, f'taskmaster-{stamp}.zip')
    snap = os.path.join(BACKUP_DIR, f'.snapshot-{stamp}.db')
    src = sqlite3.connect(os.path.join(DATA_DIR, 'taskmaster.db'))
    dst = sqlite3.connect(snap)
    with dst:
        src.backup(dst)
    src.close()
    dst.close()
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as z:
        z.write(snap, 'taskmaster.db')
        if os.path.isdir(UPLOAD_DIR):
            for name in os.listdir(UPLOAD_DIR):
                z.write(os.path.join(UPLOAD_DIR, name), f'uploads/{name}')
    os.remove(snap)
    # rotation
    backups = sorted(f for f in os.listdir(BACKUP_DIR)
                     if f.startswith('taskmaster-') and f.endswith('.zip'))
    for old in backups[:-BACKUP_KEEP]:
        try:
            os.remove(os.path.join(BACKUP_DIR, old))
        except OSError:
            pass
    print(f'TaskMaster: backup written to {target}')
    return target
