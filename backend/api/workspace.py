"""Companies, departments, the workspace tree, access grants, notification rules."""
import json

from flask import Blueprint, jsonify, request

from .. import permissions as perm
from ..auth import login_required
from ..db import db
from ..models import (AccessGrant, Board, BoardColumn, Company, Department,
                      Item, NotificationRule, Role, User)
from ..services import broadcast_board, log_activity

bp = Blueprint('workspace', __name__, url_prefix='/api')


# ---- Workspace tree (drives the sidebar) ----

@bp.get('/workspace')
@login_required
def workspace(user):
    companies = perm.accessible_companies(user)
    item_counts = dict(db.session.query(Item.board_id, db.func.count(Item.id))
                       .filter(Item.parent_id.is_(None)).group_by(Item.board_id).all())
    out = []
    for c in companies:
        direct = perm.accessible_direct_boards(user, c)
        depts = (Department.query.filter_by(company_id=c.id)
                 .order_by(Department.position, Department.id).all())
        dept_list = []
        for d in depts:
            boards = perm.accessible_boards_in(user, d)
            if not boards and not (perm.is_super(user) or perm.can_manage_company(user, c.id)):
                continue
            dept_list.append({
                **d.to_dict(),
                'boards': [{**b.to_dict(), 'access': access,
                            'items_count': item_counts.get(b.id, 0)}
                           for b, access in boards],
            })
        out.append({
            **c.to_dict(),
            'boards': [{**b.to_dict(), 'access': access,
                        'items_count': item_counts.get(b.id, 0)}
                       for b, access in direct],
            'departments': dept_list,
        })
    return jsonify({
        'companies': out,
        'can_create_companies': perm.is_super(user),
    })


# ---- Companies (super admin only) ----

@bp.post('/companies')
@login_required
def create_company(user):
    if not perm.is_super(user):
        return jsonify({'error': 'Only super admins can create companies'}), 403
    name = ((request.json or {}).get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Company name is required'}), 400
    max_pos = db.session.query(db.func.max(Company.position)).scalar() or 0
    c = Company(name=name, color=(request.json or {}).get('color') or '#0073ea',
                position=max_pos + 1)
    db.session.add(c)
    db.session.commit()
    return jsonify({'company': c.to_dict()}), 201


@bp.get('/companies/<int:company_id>')
@login_required
def get_company(user, company_id):
    c = Company.query.get_or_404(company_id)
    accessible = {ac.id for ac in perm.accessible_companies(user)}
    if c.id not in accessible:
        return jsonify({'error': 'You do not have access to this company'}), 403
    direct = perm.accessible_direct_boards(user, c)
    depts = (Department.query.filter_by(company_id=c.id)
             .order_by(Department.position, Department.id).all())
    dept_list = []
    for d in depts:
        boards = perm.accessible_boards_in(user, d)
        if not boards and not perm.can_manage_company(user, c.id) and not perm.is_super(user):
            continue
        dept_list.append({**d.to_dict(),
                          'boards': [{**b.to_dict(), 'access': a} for b, a in boards]})
    return jsonify({
        'company': c.to_dict(),
        'boards': [{**b.to_dict(), 'access': a} for b, a in direct],
        'departments': dept_list,
        'can_manage': perm.can_manage_company(user, c.id),
    })


@bp.put('/companies/<int:company_id>')
@login_required
def update_company(user, company_id):
    c = Company.query.get_or_404(company_id)
    # company admins may edit their own company's details; only supers rename others
    if not perm.can_manage_company(user, c.id):
        return jsonify({'error': 'No permission to edit this company'}), 403
    data = request.json or {}
    if data.get('name', '').strip():
        c.name = data['name'].strip()
    for field in ('color', 'address', 'phone', 'phone2', 'email', 'contact_name', 'notes'):
        if field in data:
            setattr(c, field, (data[field] or '').strip() or None)
    db.session.commit()
    return jsonify({'company': c.to_dict()})


@bp.get('/departments/<int:dept_id>')
@login_required
def get_department(user, dept_id):
    d = Department.query.get_or_404(dept_id)
    c = db.session.get(Company, d.company_id)
    accessible = {ac.id for ac in perm.accessible_companies(user)}
    if not c or c.id not in accessible:
        return jsonify({'error': 'You do not have access to this department'}), 403
    boards = perm.accessible_boards_in(user, d)
    return jsonify({
        'department': d.to_dict(),
        'company': c.to_dict(),
        'boards': [{**b.to_dict(), 'access': a} for b, a in boards],
        'can_manage': perm.can_manage_company(user, c.id),
    })


@bp.delete('/companies/<int:company_id>')
@login_required
def delete_company(user, company_id):
    if not perm.is_super(user):
        return jsonify({'error': 'Only super admins can delete companies'}), 403
    c = Company.query.get_or_404(company_id)
    if Department.query.filter_by(company_id=c.id).count():
        return jsonify({'error': 'Delete or move its departments first'}), 400
    if Board.query.filter_by(company_id=c.id).count():
        return jsonify({'error': 'Delete its boards first'}), 400
    db.session.delete(c)
    db.session.commit()
    return jsonify({'ok': True})


# ---- Departments ----

@bp.post('/companies/<int:company_id>/departments')
@login_required
def create_department(user, company_id):
    Company.query.get_or_404(company_id)
    if not perm.can_manage_company(user, company_id):
        return jsonify({'error': 'No permission to manage this company'}), 403
    data = request.json or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Department name is required'}), 400
    max_pos = (db.session.query(db.func.max(Department.position))
               .filter_by(company_id=company_id).scalar() or 0)
    d = Department(company_id=company_id, name=name,
                   icon=data.get('icon') or '🏢', position=max_pos + 1)
    db.session.add(d)
    db.session.commit()
    return jsonify({'department': d.to_dict()}), 201


@bp.put('/departments/<int:dept_id>')
@login_required
def update_department(user, dept_id):
    d = Department.query.get_or_404(dept_id)
    if not perm.can_manage_company(user, d.company_id):
        return jsonify({'error': 'No permission to manage this company'}), 403
    data = request.json or {}
    if data.get('name', '').strip():
        d.name = data['name'].strip()
    if 'icon' in data:
        d.icon = data['icon']
    db.session.commit()
    return jsonify({'department': d.to_dict()})


@bp.delete('/departments/<int:dept_id>')
@login_required
def delete_department(user, dept_id):
    d = Department.query.get_or_404(dept_id)
    if not perm.can_manage_company(user, d.company_id):
        return jsonify({'error': 'No permission to manage this company'}), 403
    if Board.query.filter_by(department_id=d.id).count():
        return jsonify({'error': 'Delete or move its boards first'}), 400
    db.session.delete(d)
    db.session.commit()
    return jsonify({'ok': True})


# ---- Access grants ----

def _grant_company_id(scope_type, scope_id):
    """Which company a grant belongs to (for company_admin validation)."""
    if scope_type == 'company':
        return scope_id
    if scope_type == 'department':
        d = db.session.get(Department, scope_id)
        return d.company_id if d else None
    if scope_type == 'board':
        b = db.session.get(Board, scope_id)
        return perm.board_company_id(b) if b else None
    if scope_type == 'item':
        i = db.session.get(Item, scope_id)
        if not i:
            return None
        b = db.session.get(Board, i.board_id)
        return perm.board_company_id(b) if b else None
    return None


def _describe_scope(g):
    if g.scope_type == 'all':
        return '🌐 All companies'
    if g.scope_type == 'company':
        c = db.session.get(Company, g.scope_id)
        return f'🏛 {c.name}' if c else '(deleted company)'
    if g.scope_type == 'department':
        d = db.session.get(Department, g.scope_id)
        if not d:
            return '(deleted department)'
        c = db.session.get(Company, d.company_id)
        return f'🏢 {c.name if c else "?"} / {d.name}'
    if g.scope_type == 'board':
        b = db.session.get(Board, g.scope_id)
        return f'📋 {b.name}' if b else '(deleted board)'
    if g.scope_type == 'item':
        i = db.session.get(Item, g.scope_id)
        if not i:
            return '(deleted item)'
        b = db.session.get(Board, i.board_id)
        return f'📄 {i.name} ({b.name if b else "?"})'
    return g.scope_type


@bp.get('/users/<int:user_id>/grants')
@login_required
def list_grants(actor, user_id):
    target = User.query.get_or_404(user_id)
    if not perm.can_manage_user(actor, target):
        return jsonify({'error': 'No permission to manage this user'}), 403
    grants = AccessGrant.query.filter_by(user_id=target.id).all()
    return jsonify({'grants': [{**g.to_dict(), 'label': _describe_scope(g)} for g in grants]})


@bp.post('/users/<int:user_id>/grants')
@login_required
def create_grant(actor, user_id):
    target = User.query.get_or_404(user_id)
    if not perm.can_manage_user(actor, target):
        return jsonify({'error': 'No permission to manage this user'}), 403
    data = request.json or {}
    scope_type = data.get('scope_type')
    scope_id = data.get('scope_id') or 0
    if scope_type == 'all':
        if not perm.is_super(actor):
            return jsonify({'error': 'Only super admins can grant access to all companies'}), 403
        scope_id = 0
    elif scope_type not in ('company', 'department', 'board', 'item') or not scope_id:
        return jsonify({'error': 'Invalid scope'}), 400
    else:
        grant_company = _grant_company_id(scope_type, int(scope_id))
        if grant_company is None and scope_type != 'company':
            return jsonify({'error': 'Scope target not found'}), 404
        if not perm.can_grant_in_company(actor, grant_company):
            return jsonify({'error': 'You can only grant access within companies you manage'}), 403
    existing = AccessGrant.query.filter_by(
        user_id=target.id, scope_type=scope_type, scope_id=int(scope_id)).first()
    if existing:
        return jsonify({'grant': {**existing.to_dict(), 'label': _describe_scope(existing)}})
    g = AccessGrant(user_id=target.id, scope_type=scope_type,
                    scope_id=int(scope_id), granted_by=actor.id)
    db.session.add(g)
    db.session.commit()
    return jsonify({'grant': {**g.to_dict(), 'label': _describe_scope(g)}}), 201


@bp.delete('/grants/<int:grant_id>')
@login_required
def delete_grant(actor, grant_id):
    g = AccessGrant.query.get_or_404(grant_id)
    target = db.session.get(User, g.user_id)
    if not target or not perm.can_manage_user(actor, target):
        return jsonify({'error': 'No permission to manage this user'}), 403
    db.session.delete(g)
    db.session.commit()
    return jsonify({'ok': True})


# ---- Roles ----

COMPANY_LEVELS = ('company_admin', 'member', 'viewer')
STAFF_LEVELS = ('admin', 'member', 'viewer')


@bp.get('/roles')
@login_required
def list_roles(user):
    """Custom roles the actor may see/assign, plus the built-in levels."""
    q = Role.query
    if not perm.is_super(user):
        if user.role == 'company_admin':
            q = q.filter(Role.company_id == user.company_id)
        elif user.role == 'admin':
            managed = perm.managed_company_ids(user)
            q = q.filter(Role.company_id.in_(managed) if managed else db.false())
        else:
            return jsonify({'roles': []})
    return jsonify({'roles': [r.to_dict() for r in q.order_by(Role.name).all()]})


@bp.post('/roles')
@login_required
def create_role(user):
    data = request.json or {}
    name = (data.get('name') or '').strip()
    level = data.get('level')
    company_id = data.get('company_id') or None
    if not name:
        return jsonify({'error': 'Role name is required'}), 400
    if company_id:
        if not db.session.get(Company, company_id):
            return jsonify({'error': 'Company not found'}), 404
        if level not in COMPANY_LEVELS:
            return jsonify({'error': f'Company role level must be one of {COMPANY_LEVELS}'}), 400
        if not perm.can_manage_company(user, company_id):
            return jsonify({'error': 'No permission to manage this company'}), 403
    else:
        if level not in STAFF_LEVELS:
            return jsonify({'error': f'IT staff role level must be one of {STAFF_LEVELS}'}), 400
        if not perm.is_super(user):
            return jsonify({'error': 'Only super admins can define IT staff roles'}), 403
    r = Role(name=name, level=level, company_id=company_id)
    db.session.add(r)
    db.session.commit()
    return jsonify({'role': r.to_dict()}), 201


@bp.delete('/roles/<int:role_id>')
@login_required
def delete_role(user, role_id):
    r = Role.query.get_or_404(role_id)
    if r.company_id:
        if not perm.can_manage_company(user, r.company_id):
            return jsonify({'error': 'No permission'}), 403
    elif not perm.is_super(user):
        return jsonify({'error': 'Only super admins can delete IT staff roles'}), 403
    User.query.filter_by(custom_role_id=r.id).update({'custom_role_id': None})
    db.session.delete(r)
    db.session.commit()
    return jsonify({'ok': True})


# ---- Notification rules ----

@bp.get('/boards/<int:board_id>/rules')
@login_required
def list_rules(user, board_id):
    board = Board.query.get_or_404(board_id)
    if not perm.can_edit_board(user, board):
        return jsonify({'error': 'No permission'}), 403
    rules = NotificationRule.query.filter_by(board_id=board.id).all()
    return jsonify({'rules': [r.to_dict() for r in rules]})


@bp.post('/boards/<int:board_id>/rules')
@login_required
def create_rule(user, board_id):
    board = Board.query.get_or_404(board_id)
    if not perm.can_edit_board(user, board):
        return jsonify({'error': 'No permission'}), 403
    data = request.json or {}
    col = BoardColumn.query.filter_by(id=data.get('column_id'), board_id=board.id).first()
    if not col or col.type not in ('status', 'priority'):
        return jsonify({'error': 'Rule needs a status column on this board'}), 400
    user_ids = [int(u) for u in (data.get('user_ids') or [])]
    if not user_ids:
        return jsonify({'error': 'Pick at least one person to notify'}), 400
    r = NotificationRule(
        board_id=board.id, column_id=col.id,
        label_id=data.get('label_id') or None,
        user_ids=json.dumps(user_ids), created_by=user.id,
    )
    db.session.add(r)
    log_activity(user.id, board.id, None, 'rule_created',
                 f'added a notification rule on {col.title}')
    db.session.commit()
    broadcast_board(board.id)
    return jsonify({'rule': r.to_dict()}), 201


@bp.delete('/rules/<int:rule_id>')
@login_required
def delete_rule(user, rule_id):
    r = NotificationRule.query.get_or_404(rule_id)
    board = db.session.get(Board, r.board_id)
    if not board or not perm.can_edit_board(user, board):
        return jsonify({'error': 'No permission'}), 403
    db.session.delete(r)
    db.session.commit()
    return jsonify({'ok': True})
