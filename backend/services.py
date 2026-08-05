"""Shared helpers: activity logging, notifications, board serialization, defaults."""
import json
import os

from . import realtime
from .db import db
from .models import (AccessGrant, Activity, Board, BoardColumn, BoardGroup,
                     FileAsset, Item, ItemUpdate, ItemValue, Notification,
                     NotificationRule)

STATUS_PRESET = [
    {'id': 'l1', 'label': 'Not Started', 'color': '#c4c4c4'},
    {'id': 'l2', 'label': 'Working on it', 'color': '#fdab3d'},
    {'id': 'l3', 'label': 'Stuck', 'color': '#e2445c'},
    {'id': 'l4', 'label': 'Done', 'color': '#00c875'},
]

PRIORITY_PRESET = [
    {'id': 'p1', 'label': 'Critical', 'color': '#333333'},
    {'id': 'p2', 'label': 'High', 'color': '#401694'},
    {'id': 'p3', 'label': 'Medium', 'color': '#5559df'},
    {'id': 'p4', 'label': 'Low', 'color': '#579bfc'},
]

GROUP_COLORS = ['#579bfc', '#00c875', '#a25ddc', '#fdab3d', '#e2445c', '#66ccff', '#ff642e']

DEFAULT_COLUMN_SETTINGS = {
    'status': {'labels': STATUS_PRESET},
    'priority': {'labels': PRIORITY_PRESET},
    'dropdown': {'options': []},
    'text': {},
    'people': {},
    'date': {},
    'number': {'unit': ''},
    'checkbox': {},
}

COLUMN_DEFAULT_WIDTH = {
    'status': 150, 'priority': 140, 'text': 180, 'people': 130,
    'date': 140, 'number': 110, 'dropdown': 160, 'checkbox': 90,
}


def log_activity(user_id, board_id, item_id, action, description, company_id=None):
    db.session.add(Activity(
        user_id=user_id, board_id=board_id, item_id=item_id,
        company_id=company_id, action=action, description=description,
    ))


def notify_user(user_id, actor_id, ntype, board_id, item_id, message):
    """Create an in-app notification (skipping self-notifications), push it
    live, and email it when the email service is on and the person wants it."""
    if user_id == actor_id or user_id is None:
        return
    n = Notification(
        user_id=user_id, actor_id=actor_id, type=ntype,
        board_id=board_id, item_id=item_id, message=message,
    )
    db.session.add(n)
    db.session.flush()
    realtime.publish({'type': 'notification'}, target_user_id=user_id)

    from .models import User
    target = db.session.get(User, user_id)
    if target and target.email and (target.email_notifications is None
                                    or target.email_notifications):
        from flask import current_app
        from . import emailer
        subjects = {
            'assigned': 'You were assigned a job',
            'status': 'Status changed',
            'update': 'New update on a job',
            'mention': 'You were mentioned',
        }
        emailer.send_async(current_app._get_current_object(), target.email,
                           f'TaskMaster: {subjects.get(ntype, "Notification")}',
                           message)


def broadcast_board(board_id, kind='board_changed'):
    realtime.publish({'type': kind, 'board_id': board_id})


def item_counts(item_ids):
    """Return {item_id: {'updates': n, 'files': n}} for a set of items."""
    counts = {i: {'updates': 0, 'files': 0} for i in item_ids}
    if not item_ids:
        return counts
    rows = (db.session.query(ItemUpdate.item_id, db.func.count(ItemUpdate.id))
            .filter(ItemUpdate.item_id.in_(item_ids)).group_by(ItemUpdate.item_id).all())
    for iid, n in rows:
        counts[iid]['updates'] = n
    rows = (db.session.query(FileAsset.item_id, db.func.count(FileAsset.id))
            .filter(FileAsset.item_id.in_(item_ids)).group_by(FileAsset.item_id).all())
    for iid, n in rows:
        counts[iid]['files'] = n
    return counts


def values_for_items(item_ids):
    """Return {item_id: {column_id: value_dict}}."""
    out = {i: {} for i in item_ids}
    if not item_ids:
        return out
    for v in ItemValue.query.filter(ItemValue.item_id.in_(item_ids)).all():
        out[v.item_id][str(v.column_id)] = v.value_dict()
    return out


def serialize_board_full(board, visible_ids=None, access='full'):
    """Full board payload. visible_ids=None means every item; a set filters
    the payload down to the items a partially-granted user may see."""
    groups = (BoardGroup.query.filter_by(board_id=board.id)
              .order_by(BoardGroup.position).all())
    columns = (BoardColumn.query.filter_by(board_id=board.id)
               .order_by(BoardColumn.position).all())
    items = (Item.query.filter_by(board_id=board.id)
             .order_by(Item.position).all())
    if visible_ids is not None:
        items = [i for i in items if i.id in visible_ids]
    ids = [i.id for i in items]
    values = values_for_items(ids)
    counts = item_counts(ids)
    subitem_counts = {}
    for i in items:
        if i.parent_id:
            subitem_counts[i.parent_id] = subitem_counts.get(i.parent_id, 0) + 1
    out_items = []
    for i in items:
        d = i.to_dict(values=values.get(i.id, {}), counts=counts.get(i.id))
        d['subitems_count'] = subitem_counts.get(i.id, 0)
        out_items.append(d)
    from . import permissions as perm
    board_users, item_extra = perm.board_assignable(board)
    user_map = {u.id: u for u in board_users}
    for lst in item_extra.values():
        for u in lst:
            user_map[u.id] = u
    assignable = {
        'users': {str(uid): u.to_dict() for uid, u in user_map.items()},
        'board_ids': [u.id for u in board_users],
        'item_ids': {str(iid): [u.id for u in lst] for iid, lst in item_extra.items()},
    }
    return {
        'board': board.to_dict(),
        'groups': [g.to_dict() for g in groups],
        'columns': [c.to_dict() for c in columns],
        'items': out_items,
        'access': access,
        'assignable': assignable,
    }


def purge_item_rows(item_ids):
    """Hard-delete everything hanging off a set of items: values, updates,
    files (incl. on disk), per-item work activity, and single-job grants.
    SQLite reuses row ids, so leftovers would attach to future items."""
    if not item_ids:
        return
    from .config import UPLOAD_DIR
    ItemValue.query.filter(ItemValue.item_id.in_(item_ids)).delete(synchronize_session=False)
    ItemUpdate.query.filter(ItemUpdate.item_id.in_(item_ids)).delete(synchronize_session=False)
    for f in FileAsset.query.filter(FileAsset.item_id.in_(item_ids)).all():
        try:
            os.remove(os.path.join(UPLOAD_DIR, f.filename))
        except OSError:
            pass
        db.session.delete(f)
    Activity.query.filter(Activity.item_id.in_(item_ids)).delete(synchronize_session=False)
    AccessGrant.query.filter(AccessGrant.scope_type == 'item',
                             AccessGrant.scope_id.in_(item_ids)).delete(synchronize_session=False)


def purge_items(items):
    """Delete items plus their sub-tasks and every dependent row."""
    all_items = list(items)
    ids = [i.id for i in all_items]
    if ids:
        subs = Item.query.filter(Item.parent_id.in_(ids),
                                 Item.id.notin_(ids)).all()
        all_items += subs
        ids = [i.id for i in all_items]
    purge_item_rows(ids)
    for i in all_items:
        db.session.delete(i)


def purge_board(board):
    """Delete a board and every dependent row. Audit entries about the board
    (deletions, access changes) survive detached from it; work history goes."""
    from .models import AUDIT_ACTION_LIST
    purge_items(Item.query.filter_by(board_id=board.id).all())
    NotificationRule.query.filter_by(board_id=board.id).delete(synchronize_session=False)
    BoardColumn.query.filter_by(board_id=board.id).delete(synchronize_session=False)
    BoardGroup.query.filter_by(board_id=board.id).delete(synchronize_session=False)
    AccessGrant.query.filter_by(scope_type='board', scope_id=board.id).delete(synchronize_session=False)
    Activity.query.filter(Activity.board_id == board.id,
                          Activity.action.notin_(AUDIT_ACTION_LIST)).delete(synchronize_session=False)
    Activity.query.filter_by(board_id=board.id).update({'board_id': None}, synchronize_session=False)
    db.session.delete(board)


def apply_template(user, board, item, template, log):
    """Fill a fresh job from a template: field values matched to the board's
    columns by type (+title when several share a type), plus its own copy of
    the sub-task list — each sub-task with its own values. Unmatched fields
    are skipped silently."""
    from datetime import date, timedelta
    data = template.data_dict()
    columns = BoardColumn.query.filter_by(board_id=board.id).order_by(BoardColumn.position).all()

    def find_column(spec):
        same_type = [c for c in columns if c.type == spec.get('type')]
        for c in same_type:
            if c.title.strip().lower() == (spec.get('title') or '').strip().lower():
                return c
        return same_type[0] if same_type else None

    def value_for(col, spec):
        if col.type in ('status', 'priority'):
            wanted = (spec.get('label') or '').strip().lower()
            for l in col.settings_dict().get('labels', []):
                if l['label'].strip().lower() == wanted:
                    return {'id': l['id']}
            return None
        if col.type == 'date' and spec.get('days') is not None:
            try:
                due = date.today() + timedelta(days=int(spec['days']))
            except (TypeError, ValueError):
                return None
            return {'date': due.isoformat()}
        if col.type == 'text' and spec.get('text'):
            return {'text': spec['text']}
        if col.type == 'number' and spec.get('number') is not None:
            return {'number': spec['number']}
        return None

    def apply_specs(target_item, specs):
        for spec in specs:
            col = find_column(spec)
            if col is None:
                continue
            value = value_for(col, spec)
            if value is None:
                continue
            db.session.add(ItemValue(item_id=target_item.id, column_id=col.id,
                                     value=json.dumps(value)))

    apply_specs(item, data.get('values', []))

    position = 0
    for sub in data.get('subtasks', []):
        name = (sub.get('name') or '').strip()
        if not name:
            continue
        position += 1
        child = Item(board_id=board.id, group_id=item.group_id, name=name,
                     parent_id=item.id, position=position, created_by=user.id)
        db.session.add(child)
        db.session.flush()
        apply_specs(child, sub.get('values') or [])
    if log:
        log_activity(user.id, board.id, item.id, 'item_created',
                     f'created "{item.name}" from template "{template.name}"')


def run_automations(trigger, board, item, actor_id, new_label_text=None):
    """Central automation engine. Applies every enabled rule matching the
    trigger for this board's company (global rules unless opted out).
    Returns the set of user ids already notified."""
    import json as _json
    from . import permissions as perm
    from .models import AutomationRule, BoardColumn, ItemValue, User
    company_id = perm.board_company_id(board)
    notified = set()
    for rule in AutomationRule.query.filter_by(enabled=True).all():
        if (rule.trigger or 'status') != trigger:
            continue
        if rule.company_id is not None and rule.company_id != company_id:
            continue
        if rule.company_id is None and company_id in rule.disabled_company_list():
            continue
        if trigger == 'status' and rule.label_text \
                and rule.label_text.strip().lower() != (new_label_text or '').strip().lower():
            continue

        action = rule.action or 'notify'
        if action == 'notify':
            targets = set(rule.user_id_list())
            if rule.notify_assignees:
                targets |= people_column_user_ids(item.id)
            what = {'status': f'changed to {new_label_text}',
                    'created': 'was created',
                    'overdue': 'is overdue'}[trigger]
            for uid in targets:
                if uid not in notified:
                    notify_user(uid, actor_id, 'status', board.id, item.id,
                                f'"{item.name}" on {board.name} {what}')
                    notified.add(uid)
        elif action == 'set_status':
            col = (BoardColumn.query.filter_by(board_id=board.id, type='status')
                   .order_by(BoardColumn.position).first())
            wanted = (rule.action_param or '').strip().lower()
            label = col and next((l for l in col.settings_dict().get('labels', [])
                                  if l['label'].strip().lower() == wanted), None)
            if col and label:
                iv = ItemValue.query.filter_by(item_id=item.id, column_id=col.id).first()
                if not (iv and iv.value_dict().get('id') == label['id']):
                    if iv:
                        iv.value = _json.dumps({'id': label['id']})
                    else:
                        db.session.add(ItemValue(item_id=item.id, column_id=col.id,
                                                 value=_json.dumps({'id': label['id']})))
                    log_activity(rule.created_by, board.id, item.id, 'value_changed',
                                 f'automation set Status of "{item.name}" to {label["label"]}')
        elif action == 'assign':
            try:
                target_id = int(rule.action_param or 0)
            except ValueError:
                continue
            target = db.session.get(User, target_id)
            col = (BoardColumn.query.filter_by(board_id=board.id, type='people')
                   .order_by(BoardColumn.position).first())
            if target and target.is_active and col \
                    and target_id in perm.eligible_assignee_ids(item):
                iv = ItemValue.query.filter_by(item_id=item.id, column_id=col.id).first()
                ids = set((iv.value_dict().get('user_ids') if iv else None) or [])
                if target_id not in ids:
                    ids.add(target_id)
                    payload = _json.dumps({'user_ids': sorted(ids)})
                    if iv:
                        iv.value = payload
                    else:
                        db.session.add(ItemValue(item_id=item.id, column_id=col.id, value=payload))
                    log_activity(rule.created_by, board.id, item.id, 'value_changed',
                                 f'automation assigned {target.display_name} to "{item.name}"')
                    notify_user(target_id, actor_id, 'assigned', board.id, item.id,
                                f'You were assigned to "{item.name}" on {board.name} (automation)')
                    notified.add(target_id)
    return notified


def create_default_board_layout(board):
    """Give a fresh board monday-style defaults: two groups + core columns."""
    if (BoardColumn.query.filter_by(board_id=board.id).count()
            or BoardGroup.query.filter_by(board_id=board.id).count()):
        return  # never double-up defaults on a board that already has a layout
    db.session.add(BoardGroup(board_id=board.id, name='To-Do', color='#579bfc', position=1))
    db.session.add(BoardGroup(board_id=board.id, name='Completed', color='#00c875', position=2))
    defaults = [
        ('Status', 'status'), ('People', 'people'), ('Due date', 'date'), ('Priority', 'priority'),
    ]
    for pos, (title, ctype) in enumerate(defaults, start=1):
        db.session.add(BoardColumn(
            board_id=board.id, title=title, type=ctype,
            settings=json.dumps(DEFAULT_COLUMN_SETTINGS[ctype]),
            position=pos, width=COLUMN_DEFAULT_WIDTH[ctype],
        ))


def people_column_user_ids(item_id):
    """All user ids present in any people-column value of an item."""
    ids = set()
    for v in ItemValue.query.filter_by(item_id=item_id).all():
        col = BoardColumn.query.get(v.column_id)
        if col and col.type == 'people':
            ids.update(v.value_dict().get('user_ids') or [])
    return ids
