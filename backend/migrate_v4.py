"""Schema + data upgrade for the multi-company version (v4).

- Adds new columns to existing tables (SQLite ALTER TABLE, since create_all
  only creates missing tables).
- Wraps any pre-existing boards into a default company/department.
- Upgrades legacy roles: admin -> super_admin.
- Members keep seeing the boards that existed before permissions arrived
  (board-level grants), so nothing disappears on upgrade.
"""
import json

from sqlalchemy import inspect, text

from .db import db
from .models import (AUDIT_ACTION_LIST, AccessGrant, Activity, AutomationRule,
                     Board, BoardColumn, BoardGroup, Company, Department,
                     FileAsset, Item, ItemUpdate, ItemValue, NotificationRule,
                     User)


def _ensure_column(table, column, ddl):
    inspector = inspect(db.engine)
    cols = {c['name'] for c in inspector.get_columns(table)}
    if column not in cols:
        db.session.execute(text(f'ALTER TABLE {table} ADD COLUMN {ddl}'))
        db.session.commit()
        print(f'TaskMaster: added {table}.{column}')


def ensure_schema():
    """Add new columns to tables from older deployments. Must run BEFORE any
    ORM query touches these tables (including the v2 data migration)."""
    inspector = inspect(db.engine)
    tables = set(inspector.get_table_names())
    if 'users' in tables:
        _ensure_column('users', 'company_id', 'company_id INTEGER')
        _ensure_column('users', 'custom_role_id', 'custom_role_id INTEGER')
        _ensure_column('users', 'hide_done', 'hide_done INTEGER DEFAULT 0')
        _ensure_column('users', 'must_change_password', 'must_change_password INTEGER DEFAULT 0')
        _ensure_column('users', 'email_notifications', 'email_notifications INTEGER DEFAULT 1')
        _ensure_column('users', 'totp_secret', 'totp_secret VARCHAR(64)')
    if 'automation_rules' in tables:
        _ensure_column('automation_rules', 'trigger', "\"trigger\" VARCHAR(20) DEFAULT 'status'")
        _ensure_column('automation_rules', 'action', "action VARCHAR(20) DEFAULT 'notify'")
        _ensure_column('automation_rules', 'action_param', 'action_param VARCHAR(200)')
    if 'activity' in tables:
        _ensure_column('activity', 'company_id', 'company_id INTEGER')
    if 'roles' in tables:
        _ensure_column('roles', 'permissions', "permissions TEXT DEFAULT '[]'")
    if 'boards' in tables:
        _ensure_column('boards', 'department_id', 'department_id INTEGER')
    if 'items' in tables:
        _ensure_column('items', 'parent_id', 'parent_id INTEGER')
    if 'boards' in tables:
        _ensure_column('boards', 'company_id', 'company_id INTEGER')
    if 'companies' in tables:
        for col in ('address TEXT', 'phone VARCHAR(60)', 'phone2 VARCHAR(60)',
                    'email VARCHAR(200)', 'contact_name VARCHAR(200)', 'notes TEXT'):
            _ensure_column('companies', col.split()[0], col)


def migrate_v4_data():
    # Legacy role names
    upgraded = User.query.filter_by(role='admin').all()
    for u in upgraded:
        u.role = 'super_admin'
    if upgraded:
        db.session.commit()
        print(f'TaskMaster: upgraded {len(upgraded)} admin(s) to super_admin')

    # Boards created before companies existed get a default home.
    # Boards with company_id set are intentionally direct-under-company — leave them.
    orphans = Board.query.filter(Board.department_id.is_(None),
                                 Board.company_id.is_(None)).all()
    if orphans:
        company = Company.query.order_by(Company.id).first()
        if company is None:
            company = Company(name='My Company', position=1)
            db.session.add(company)
            db.session.flush()
        dept = (Department.query.filter_by(company_id=company.id)
                .order_by(Department.id).first())
        if dept is None:
            dept = Department(company_id=company.id, name='General', position=1)
            db.session.add(dept)
            db.session.flush()
        for b in orphans:
            b.department_id = dept.id
        # members keep access to boards that pre-date permissions
        members = User.query.filter(User.role.notin_(['super_admin'])).all()
        for m in members:
            for b in orphans:
                exists = AccessGrant.query.filter_by(
                    user_id=m.id, scope_type='board', scope_id=b.id).first()
                if not exists:
                    db.session.add(AccessGrant(
                        user_id=m.id, scope_type='board', scope_id=b.id))
        db.session.commit()
        print(f'TaskMaster: placed {len(orphans)} board(s) into "{company.name} / {dept.name}"')

    _cleanup_orphans()
    _dedupe_default_columns()
    _migrate_board_rules()


def _cleanup_orphans():
    """Earlier versions deleted boards without cascading, leaving items/groups/
    columns/values behind — they inflated every count and, because SQLite
    reuses row ids, could attach old data to brand-new rows. Sweep them out."""
    removed = 0
    board_ids = {b.id for b in Board.query.with_entities(Board.id)}

    def sweep(query):
        nonlocal removed
        n = query.delete(synchronize_session=False)
        removed += n
        return n

    sweep(BoardGroup.query.filter(~BoardGroup.board_id.in_(board_ids)))
    sweep(BoardColumn.query.filter(~BoardColumn.board_id.in_(board_ids)))
    sweep(Item.query.filter(~Item.board_id.in_(board_ids)))
    # sub-tasks whose parent job is gone
    item_ids = {i.id for i in Item.query.with_entities(Item.id)}
    sweep(Item.query.filter(Item.parent_id.isnot(None), ~Item.parent_id.in_(item_ids)))

    item_ids = {i.id for i in Item.query.with_entities(Item.id)}
    col_ids = {c.id for c in BoardColumn.query.with_entities(BoardColumn.id)}
    sweep(ItemValue.query.filter(~ItemValue.item_id.in_(item_ids)
                                 | ~ItemValue.column_id.in_(col_ids)))
    sweep(ItemUpdate.query.filter(~ItemUpdate.item_id.in_(item_ids)))
    sweep(FileAsset.query.filter(~FileAsset.item_id.in_(item_ids)))
    sweep(NotificationRule.query.filter(~NotificationRule.board_id.in_(board_ids)
                                        | ~NotificationRule.column_id.in_(col_ids)))
    # per-item work history of items that no longer exist (audit rows keep item_id NULL)
    sweep(Activity.query.filter(Activity.item_id.isnot(None),
                                ~Activity.item_id.in_(item_ids)))
    # non-audit activity pointing at deleted boards; audit rows just detach
    sweep(Activity.query.filter(Activity.board_id.isnot(None),
                                ~Activity.board_id.in_(board_ids),
                                Activity.action.notin_(AUDIT_ACTION_LIST)))
    Activity.query.filter(Activity.board_id.isnot(None),
                          ~Activity.board_id.in_(board_ids)).update(
        {'board_id': None}, synchronize_session=False)
    # access grants whose target object is gone
    dept_ids = {d.id for d in Department.query.with_entities(Department.id)}
    company_ids = {c.id for c in Company.query.with_entities(Company.id)}
    for scope, ids in (('board', board_ids), ('item', item_ids),
                       ('department', dept_ids), ('company', company_ids)):
        sweep(AccessGrant.query.filter(AccessGrant.scope_type == scope,
                                       ~AccessGrant.scope_id.in_(ids)))
    if removed:
        db.session.commit()
        print(f'TaskMaster: cleaned up {removed} orphaned row(s) from earlier deletions')


def _dedupe_default_columns():
    """Some boards ended up with doubled Status/Due date/Priority columns.
    Keep the copy holding the data (values move over where possible)."""
    removed = 0
    for board in Board.query.all():
        cols = (BoardColumn.query.filter_by(board_id=board.id)
                .order_by(BoardColumn.position, BoardColumn.id).all())
        by_key = {}
        for c in cols:
            by_key.setdefault((c.title.strip().lower(), c.type), []).append(c)
        for dupes in by_key.values():
            if len(dupes) < 2:
                continue
            counts = {c.id: ItemValue.query.filter_by(column_id=c.id).count() for c in dupes}
            keeper = max(dupes, key=lambda c: (counts[c.id], -c.id))
            for c in dupes:
                if c.id == keeper.id:
                    continue
                # move values the keeper doesn't have; drop the rest
                taken = {v.item_id for v in ItemValue.query.filter_by(column_id=keeper.id)}
                for v in ItemValue.query.filter_by(column_id=c.id).all():
                    if v.item_id in taken:
                        db.session.delete(v)
                    else:
                        v.column_id = keeper.id
                NotificationRule.query.filter_by(column_id=c.id).update(
                    {'column_id': keeper.id}, synchronize_session=False)
                db.session.delete(c)
                removed += 1
    if removed:
        db.session.commit()
        print(f'TaskMaster: removed {removed} duplicated column(s)')


def _migrate_board_rules():
    """Per-board notification rules move into the central automations system,
    scoped to the board's company."""
    rules = NotificationRule.query.all()
    if not rules:
        return
    migrated = 0
    for r in rules:
        board = db.session.get(Board, r.board_id)
        col = db.session.get(BoardColumn, r.column_id)
        db.session.delete(r)
        if board is None or col is None:
            continue
        from . import permissions as perm
        company_id = perm.board_company_id(board)
        label_text = None
        if r.label_id:
            labels = {l['id']: l['label'] for l in col.settings_dict().get('labels', [])}
            label_text = labels.get(r.label_id)
        db.session.add(AutomationRule(
            company_id=company_id,
            name=(f'{board.name}: notify when {col.title} becomes {label_text}'
                  if label_text else f'{board.name}: notify on {col.title} change'),
            label_text=label_text,
            notify_user_ids=json.dumps(r.user_id_list()),
            created_by=r.created_by,
        ))
        migrated += 1
    db.session.commit()
    print(f'TaskMaster: migrated {migrated} board notification rule(s) to central automations')
