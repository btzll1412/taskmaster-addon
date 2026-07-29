"""Schema + data upgrade for the multi-company version (v4).

- Adds new columns to existing tables (SQLite ALTER TABLE, since create_all
  only creates missing tables).
- Wraps any pre-existing boards into a default company/department.
- Upgrades legacy roles: admin -> super_admin.
- Members keep seeing the boards that existed before permissions arrived
  (board-level grants), so nothing disappears on upgrade.
"""
from sqlalchemy import inspect, text

from .db import db
from .models import AccessGrant, Board, Company, Department, User


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
