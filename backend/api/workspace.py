"""Companies, departments, the workspace tree, access grants, automations, templates."""
import json

from flask import Blueprint, jsonify, request

from .. import permissions as perm
from ..auth import login_required
from ..db import db
from ..models import (AccessGrant, Board, BoardColumn, Company, Department,
                      Item, JobTemplate, Role, User)
from ..services import log_activity

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
                'can_create_board': perm.can_create_board_in(user, c.id, d.id),
                'boards': [{**b.to_dict(), 'access': access,
                            'items_count': item_counts.get(b.id, 0)}
                           for b, access in boards],
            })
        out.append({
            **c.to_dict(),
            'can_manage': perm.can_manage_company(user, c.id),
            'can_create_board': perm.can_create_board_in(user, c.id),
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
                          'can_create_board': perm.can_create_board_in(user, c.id, d.id),
                          'boards': [{**b.to_dict(), 'access': a} for b, a in boards]})
    return jsonify({
        'company': c.to_dict(),
        'boards': [{**b.to_dict(), 'access': a} for b, a in direct],
        'departments': dept_list,
        'can_manage': perm.can_manage_company(user, c.id),
        'can_create_board': perm.can_create_board_in(user, c.id),
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
        'can_create_board': perm.can_create_board_in(user, c.id, d.id),
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
    log_activity(user.id, None, None, 'company_deleted', f'deleted company "{c.name}"')
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
    c = db.session.get(Company, d.company_id)
    log_activity(user.id, None, None, 'department_deleted',
                 f'deleted department "{d.name}" from {c.name if c else "?"}',
                 company_id=d.company_id)
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
    db.session.flush()
    log_activity(actor.id, None, None, 'access_granted',
                 f'granted {target.display_name} access to {_describe_scope(g)}',
                 company_id=target.company_id)
    db.session.commit()
    return jsonify({'grant': {**g.to_dict(), 'label': _describe_scope(g)}}), 201


@bp.put('/grants/<int:grant_id>')
@login_required
def update_grant(actor, grant_id):
    """Change an existing access rule in place (e.g. widen board -> department)."""
    g = AccessGrant.query.get_or_404(grant_id)
    target = db.session.get(User, g.user_id)
    if not target or not perm.can_manage_user(actor, target):
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
    dupe = AccessGrant.query.filter_by(user_id=g.user_id, scope_type=scope_type,
                                       scope_id=int(scope_id)).first()
    if dupe and dupe.id != g.id:
        return jsonify({'error': 'They already have that exact access'}), 409
    old_label = _describe_scope(g)
    g.scope_type = scope_type
    g.scope_id = int(scope_id)
    log_activity(actor.id, None, None, 'access_changed',
                 f"changed {target.display_name}'s access from {old_label} to {_describe_scope(g)}",
                 company_id=target.company_id)
    db.session.commit()
    return jsonify({'grant': {**g.to_dict(), 'label': _describe_scope(g)}})


@bp.delete('/grants/<int:grant_id>')
@login_required
def delete_grant(actor, grant_id):
    g = AccessGrant.query.get_or_404(grant_id)
    target = db.session.get(User, g.user_id)
    if not target or not perm.can_manage_user(actor, target):
        return jsonify({'error': 'No permission to manage this user'}), 403
    log_activity(actor.id, None, None, 'access_revoked',
                 f'revoked {target.display_name}\'s access to {_describe_scope(g)}',
                 company_id=target.company_id)
    db.session.delete(g)
    db.session.commit()
    return jsonify({'ok': True})


# ---- Roles (universal, capability-based) ----

@bp.get('/roles')
@login_required
def list_roles(user):
    """Universal custom roles. Visible to anyone who can manage users."""
    if not (user.role in ('super_admin', 'admin', 'company_admin')
            or perm.has_cap(user, perm.CAP_USERS)):
        return jsonify({'roles': [], 'capabilities': []})
    roles = Role.query.order_by(Role.name).all()
    return jsonify({
        'roles': [r.to_dict() for r in roles],
        'capabilities': sorted(perm.ALL_CAPS),
    })


@bp.post('/roles')
@login_required
def create_role(user):
    if not perm.is_super(user):
        return jsonify({'error': 'Only super admins can define roles'}), 403
    data = request.json or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Role name is required'}), 400
    perms = [p for p in (data.get('permissions') or []) if p in perm.ALL_CAPS]
    r = Role(name=name, level='member', permissions=json.dumps(perms))
    db.session.add(r)
    db.session.commit()
    return jsonify({'role': r.to_dict()}), 201


@bp.put('/roles/<int:role_id>')
@login_required
def update_role(user, role_id):
    if not perm.is_super(user):
        return jsonify({'error': 'Only super admins can edit roles'}), 403
    r = Role.query.get_or_404(role_id)
    data = request.json or {}
    if data.get('name', '').strip():
        r.name = data['name'].strip()
    if 'permissions' in data:
        r.permissions = json.dumps([p for p in data['permissions'] if p in perm.ALL_CAPS])
    db.session.commit()
    return jsonify({'role': r.to_dict()})


@bp.delete('/roles/<int:role_id>')
@login_required
def delete_role(user, role_id):
    if not perm.is_super(user):
        return jsonify({'error': 'Only super admins can delete roles'}), 403
    r = Role.query.get_or_404(role_id)
    User.query.filter_by(custom_role_id=r.id).update({'custom_role_id': None})
    log_activity(user.id, None, None, 'role_deleted', f'deleted role "{r.name}"')
    db.session.delete(r)
    db.session.commit()
    return jsonify({'ok': True})


# ---- Audit log ----

from ..models import AUDIT_ACTION_LIST as AUDIT_ACTIONS  # noqa: E402


@bp.get('/audit')
@login_required
def audit(user):
    """Deletions and admin actions, scoped to what the viewer administers."""
    if not (user.role in ('super_admin', 'admin', 'company_admin')
            or perm.has_cap(user, perm.CAP_USERS)):
        return jsonify({'error': 'No permission'}), 403
    from ..models import Activity
    q = Activity.query.filter(Activity.action.in_(AUDIT_ACTIONS))
    if not perm.is_super(user):
        if user.role == 'admin':
            managed = perm.managed_company_ids(user)
            q = q.filter(Activity.company_id.in_(managed) if managed else db.false())
        else:
            q = q.filter(Activity.company_id == user.company_id)
    rows = q.order_by(Activity.created_at.desc()).limit(200).all()
    users = {u.id: u.to_dict() for u in User.query.all()}
    return jsonify({'audit': [a.to_dict() for a in rows], 'users': users})


# ---- Automations (central, admin-managed) ----

def _automation_admin(user):
    """super/staff admins manage global + managed companies; company admins their own."""
    return user.role in ('super_admin', 'admin', 'company_admin')


def _admin_company_ids(user):
    if user.role == 'admin':
        return set(perm.managed_company_ids(user))
    if user.role == 'company_admin':
        return {user.company_id} if user.company_id else set()
    return set()


@bp.get('/automations')
@login_required
def list_automations(user):
    from ..models import AutomationRule
    if not _automation_admin(user):
        return jsonify({'error': 'No permission'}), 403
    rules = AutomationRule.query.order_by(AutomationRule.company_id.isnot(None),
                                          AutomationRule.id).all()
    if not perm.is_super(user):
        mine = _admin_company_ids(user)
        rules = [r for r in rules if r.company_id is None or r.company_id in mine]
    users = {u.id: u.to_dict() for u in User.query.all()}
    companies = {c.id: c.name for c in Company.query.all()}
    return jsonify({'automations': [r.to_dict() for r in rules],
                    'users': users, 'company_names': companies})


@bp.post('/automations')
@login_required
def create_automation(user):
    from ..models import AutomationRule
    if not _automation_admin(user):
        return jsonify({'error': 'No permission'}), 403
    data = request.json or {}
    company_id = data.get('company_id')
    if perm.is_super(user):
        company_id = int(company_id) if company_id else None  # None = every company
    else:
        mine = _admin_company_ids(user)
        if not company_id or int(company_id) not in mine:
            return jsonify({'error': 'You can only create automations for your own company'}), 403
        company_id = int(company_id)
    trigger = data.get('trigger') or 'status'
    if trigger not in ('status', 'created', 'overdue'):
        return jsonify({'error': 'Unknown trigger'}), 400
    action = data.get('action') or 'notify'
    if action not in ('notify', 'set_status', 'assign'):
        return jsonify({'error': 'Unknown action'}), 400
    user_ids = [int(u) for u in (data.get('notify_user_ids') or [])]
    notify_assignees = bool(data.get('notify_assignees'))
    action_param = (str(data.get('action_param') or '')).strip() or None
    if action == 'notify' and not user_ids and not notify_assignees:
        return jsonify({'error': 'Pick people to notify (or the assigned people option)'}), 400
    if action in ('set_status', 'assign') and not action_param:
        return jsonify({'error': 'Pick what the action should do'}), 400
    label = (data.get('label_text') or '').strip() or None
    r = AutomationRule(
        company_id=company_id,
        name=(data.get('name') or '').strip() or 'Automation',
        trigger=trigger,
        label_text=label if trigger == 'status' else None,
        action=action,
        action_param=action_param,
        notify_user_ids=json.dumps(user_ids),
        notify_assignees=notify_assignees,
        created_by=user.id,
    )
    db.session.add(r)
    db.session.commit()
    return jsonify({'automation': r.to_dict()}), 201


@bp.put('/automations/<int:rule_id>')
@login_required
def update_automation(user, rule_id):
    from ..models import AutomationRule
    if not _automation_admin(user):
        return jsonify({'error': 'No permission'}), 403
    r = AutomationRule.query.get_or_404(rule_id)
    data = request.json or {}
    mine = _admin_company_ids(user)

    if perm.is_super(user) or (r.company_id and r.company_id in mine):
        # full edit rights on own rules (super: on everything)
        if 'name' in data:
            r.name = (data['name'] or '').strip()
        if 'label_text' in data:
            r.label_text = (data['label_text'] or '').strip() or None
        if 'notify_user_ids' in data:
            r.notify_user_ids = json.dumps([int(u) for u in (data['notify_user_ids'] or [])])
        if 'notify_assignees' in data:
            r.notify_assignees = bool(data['notify_assignees'])
        if 'enabled' in data:
            r.enabled = bool(data['enabled'])
    elif r.company_id is None and mine and 'enabled' in data:
        # company admin toggling a global rule: opt their company in/out only
        disabled = set(r.disabled_company_list())
        if data['enabled']:
            disabled -= mine
        else:
            disabled |= mine
        r.disabled_company_ids = json.dumps(sorted(disabled))
    else:
        return jsonify({'error': 'No permission to change this automation'}), 403
    db.session.commit()
    return jsonify({'automation': r.to_dict()})


@bp.delete('/automations/<int:rule_id>')
@login_required
def delete_automation(user, rule_id):
    from ..models import AutomationRule
    r = AutomationRule.query.get_or_404(rule_id)
    mine = _admin_company_ids(user)
    if not (perm.is_super(user) or (r.company_id and r.company_id in mine)):
        return jsonify({'error': 'No permission to delete this automation'}), 403
    db.session.delete(r)
    db.session.commit()
    return jsonify({'ok': True})


# ---- Recurring jobs ----

@bp.get('/recurring')
@login_required
def list_recurring(user):
    from ..models import JobTemplate, RecurringJob, User as U
    rules = RecurringJob.query.order_by(RecurringJob.id).all()
    out = []
    for r in rules:
        board = db.session.get(Board, r.board_id)
        if board is None or not perm.can_create_board_in(user, perm.board_company_id(board)) \
                and not (perm.board_access(user, board) == 'full' and perm.has_cap(user, perm.CAP_CREATE)):
            continue
        d = r.to_dict()
        d['board_name'] = board.name
        d['board_icon'] = board.icon
        out.append(d)
    templates = {t.id: t.name for t in JobTemplate.query.all()}
    users = {u.id: u.display_name for u in U.query.all()}
    return jsonify({'recurring': out, 'template_names': templates, 'user_names': users})


@bp.post('/recurring')
@login_required
def create_recurring(user):
    from ..models import RecurringJob
    from ..scheduler import compute_next_run
    data = request.json or {}
    board = Board.query.get_or_404(data.get('board_id'))
    if not (perm.board_access(user, board) == 'full' and perm.has_cap(user, perm.CAP_CREATE)):
        return jsonify({'error': 'No permission to create jobs on this board'}), 403
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Job name is required'}), 400
    freq = data.get('frequency')
    if freq not in ('daily', 'weekly', 'monthly'):
        return jsonify({'error': 'Pick how often it repeats'}), 400
    weekday = max(0, min(6, int(data.get('weekday') or 0)))
    monthday = max(1, min(28, int(data.get('monthday') or 1)))
    r = RecurringJob(
        board_id=board.id, name=name,
        template_id=data.get('template_id') or None,
        assignee_id=data.get('assignee_id') or None,
        frequency=freq, weekday=weekday, monthday=monthday,
        next_run_at=compute_next_run(freq, weekday, monthday),
        created_by=user.id,
    )
    db.session.add(r)
    db.session.commit()
    return jsonify({'recurring': r.to_dict()}), 201


@bp.put('/recurring/<int:rule_id>')
@login_required
def update_recurring(user, rule_id):
    from ..models import RecurringJob
    r = RecurringJob.query.get_or_404(rule_id)
    board = db.session.get(Board, r.board_id)
    if not (r.created_by == user.id or perm.is_super(user)
            or (board and perm.can_manage_company(user, perm.board_company_id(board)))):
        return jsonify({'error': 'No permission to change this recurring job'}), 403
    data = request.json or {}
    if 'enabled' in data:
        r.enabled = bool(data['enabled'])
    db.session.commit()
    return jsonify({'recurring': r.to_dict()})


@bp.delete('/recurring/<int:rule_id>')
@login_required
def delete_recurring(user, rule_id):
    from ..models import RecurringJob
    r = RecurringJob.query.get_or_404(rule_id)
    board = db.session.get(Board, r.board_id)
    if not (r.created_by == user.id or perm.is_super(user)
            or (board and perm.can_manage_company(user, perm.board_company_id(board)))):
        return jsonify({'error': 'No permission to delete this recurring job'}), 403
    db.session.delete(r)
    db.session.commit()
    return jsonify({'ok': True})


# ---- Backups (super admin) ----

@bp.get('/backups')
@login_required
def list_backups(user):
    import os
    from ..scheduler import BACKUP_DIR
    if not perm.is_super(user):
        return jsonify({'error': 'Only the super admin can manage backups'}), 403
    out = []
    if os.path.isdir(BACKUP_DIR):
        for f in sorted(os.listdir(BACKUP_DIR), reverse=True):
            if f.startswith('taskmaster-') and f.endswith('.zip'):
                p = os.path.join(BACKUP_DIR, f)
                out.append({'name': f, 'size': os.path.getsize(p)})
    return jsonify({'backups': out})


@bp.post('/backups/run')
@login_required
def run_backup_now(user):
    from ..scheduler import run_backup
    if not perm.is_super(user):
        return jsonify({'error': 'Only the super admin can manage backups'}), 403
    try:
        target = run_backup()
    except Exception as e:  # noqa: BLE001
        return jsonify({'error': f'Backup failed: {e}'}), 500
    import os
    return jsonify({'ok': True, 'name': os.path.basename(target)})


@bp.get('/backups/<path:name>/download')
@login_required
def download_backup(user, name):
    import os
    from flask import send_from_directory
    from ..scheduler import BACKUP_DIR
    if not perm.is_super(user):
        return jsonify({'error': 'Only the super admin can manage backups'}), 403
    if '/' in name or not name.startswith('taskmaster-') or not name.endswith('.zip'):
        return jsonify({'error': 'Unknown backup'}), 404
    return send_from_directory(BACKUP_DIR, name, as_attachment=True)


# ---- Customer requests (works even for people who cannot create jobs) ----

@bp.post('/requests')
@login_required
def create_request(user):
    """A simple 'ask for help' intake: lands as a job on the company's
    Requests board, with the requester attached and admins notified."""
    import json as _json
    from ..models import BoardColumn, BoardGroup, Item, ItemUpdate, ItemValue, User as U
    from ..services import broadcast_board, log_activity, notify_user
    data = request.json or {}
    subject = (data.get('subject') or '').strip()
    if not subject:
        return jsonify({'error': 'Tell us what you need in the subject'}), 400
    details = (data.get('details') or '').strip()
    if not user.company_id:
        return jsonify({'error': 'Requests are for company users — staff can create jobs directly'}), 400
    company = db.session.get(Company, user.company_id)
    board = Board.query.filter_by(company_id=company.id, name='Requests').first()
    if board is None:
        from ..services import create_default_board_layout
        board = Board(name='Requests', icon='📨', company_id=company.id,
                      owner_id=user.id, position=999)
        db.session.add(board)
        db.session.flush()
        create_default_board_layout(board)
    group = (BoardGroup.query.filter_by(board_id=board.id)
             .order_by(BoardGroup.position).first())
    max_pos = (db.session.query(db.func.max(Item.position))
               .filter_by(group_id=group.id).scalar() or 0)
    item = Item(board_id=board.id, group_id=group.id, name=subject,
                position=max_pos + 1, created_by=user.id)
    db.session.add(item)
    db.session.flush()
    people = (BoardColumn.query.filter_by(board_id=board.id, type='people')
              .order_by(BoardColumn.position).first())
    if people:
        db.session.add(ItemValue(item_id=item.id, column_id=people.id,
                                 value=_json.dumps({'user_ids': [user.id]})))
    if details:
        db.session.add(ItemUpdate(item_id=item.id, user_id=user.id, body=details))
    log_activity(user.id, board.id, item.id, 'item_created',
                 f'submitted request "{subject}"')
    # tell the company admins and the staff who manage this company
    for admin in U.query.filter_by(is_active=True).all():
        if admin.id == user.id:
            continue
        if (admin.role == 'super_admin'
                or (admin.role == 'company_admin' and admin.company_id == company.id)
                or (admin.role == 'admin' and company.id in perm.managed_company_ids(admin))):
            notify_user(admin.id, user.id, 'update', board.id, item.id,
                        f'{user.display_name} submitted a request: "{subject}" ({company.name})')
    db.session.commit()
    broadcast_board(board.id)
    return jsonify({'ok': True, 'item_id': item.id}), 201


# ---- Email service (super admin) ----

@bp.get('/email-settings')
@login_required
def get_email_settings(user):
    if not perm.is_super(user):
        return jsonify({'error': 'Only the super admin can manage the email service'}), 403
    from .. import emailer
    return jsonify({'settings': emailer.public_config()})


@bp.put('/email-settings')
@login_required
def update_email_settings(user):
    if not perm.is_super(user):
        return jsonify({'error': 'Only the super admin can manage the email service'}), 403
    from .. import emailer
    emailer.save_config(request.json or {})
    db.session.commit()
    return jsonify({'settings': emailer.public_config()})


@bp.post('/email-settings/test')
@login_required
def test_email_settings(user):
    if not perm.is_super(user):
        return jsonify({'error': 'Only the super admin can manage the email service'}), 403
    from .. import emailer
    to = ((request.json or {}).get('to') or user.email or '').strip()
    if not to:
        return jsonify({'error': 'Enter an address to send the test to (or set your own email in Settings)'}), 400
    cfg = emailer.get_config()
    cfg['enabled'] = True  # allow testing before switching it on
    err = emailer.send_email(to, 'TaskMaster test email',
                             'It works! Your TaskMaster email service is configured correctly.',
                             cfg)
    if err:
        return jsonify({'error': f'Sending failed: {err}'}), 400
    return jsonify({'ok': True})


# ---- Directory (LDAP / Active Directory) ----

@bp.get('/ldap-settings')
@login_required
def get_ldap_settings(user):
    if not perm.is_super(user):
        return jsonify({'error': 'Only the super admin can manage directory login'}), 403
    from .. import ldap_auth
    return jsonify({'settings': ldap_auth.get_config()})


@bp.put('/ldap-settings')
@login_required
def update_ldap_settings(user):
    if not perm.is_super(user):
        return jsonify({'error': 'Only the super admin can manage directory login'}), 403
    from .. import ldap_auth
    cfg = ldap_auth.save_config(request.json or {})
    db.session.commit()
    return jsonify({'settings': cfg})


# ---- Job templates ----

def _clean_specs(specs):
    out = []
    for spec in (specs or [])[:30]:
        if not isinstance(spec, dict) or not spec.get('type'):
            continue
        keep = {'type': str(spec['type']), 'title': str(spec.get('title') or '')}
        for k in ('label', 'text', 'number', 'days'):
            if spec.get(k) not in (None, ''):
                keep[k] = spec[k]
        if len(keep) > 2:
            out.append(keep)
    return out


def _clean_template_data(data):
    """Keep only the shapes apply_template understands."""
    subtasks = []
    for sub in (data.get('subtasks') or [])[:100]:
        if isinstance(sub, dict):
            name = (sub.get('name') or '').strip()
            values = _clean_specs(sub.get('values'))
        else:
            name, values = str(sub).strip(), []
        if name:
            subtasks.append({'name': name[:500], 'values': values})
    return {'values': _clean_specs(data.get('values')), 'subtasks': subtasks}


@bp.get('/templates')
@login_required
def list_templates(user):
    mine = JobTemplate.query.filter_by(owner_id=user.id).order_by(JobTemplate.name).all()
    shared = (JobTemplate.query.filter(JobTemplate.shared.is_(True),
                                       JobTemplate.owner_id != user.id)
              .order_by(JobTemplate.name).all())
    owners = {u.id: u.display_name for u in User.query.all()}
    def out(rows):
        result = []
        for t in rows:
            d = t.to_dict()
            d['owner_name'] = owners.get(t.owner_id, '?')
            result.append(d)
        return result
    return jsonify({'mine': out(mine), 'shared': out(shared)})


@bp.post('/templates')
@login_required
def create_template(user):
    if not perm.has_cap(user, perm.CAP_CREATE):
        return jsonify({'error': 'Your role cannot create jobs'}), 403
    data = request.json or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Template name is required'}), 400
    t = JobTemplate(
        name=name, icon=data.get('icon') or '📦', owner_id=user.id,
        shared=bool(data.get('shared')),
        data=json.dumps(_clean_template_data(data.get('data') or {})),
    )
    db.session.add(t)
    db.session.commit()
    return jsonify({'template': t.to_dict()}), 201


@bp.put('/templates/<int:template_id>')
@login_required
def update_template(user, template_id):
    t = JobTemplate.query.get_or_404(template_id)
    if t.owner_id != user.id and not perm.is_super(user):
        return jsonify({'error': 'Only the owner can edit this template'}), 403
    data = request.json or {}
    if data.get('name', '').strip():
        t.name = data['name'].strip()
    if 'icon' in data:
        t.icon = data['icon'] or '📦'
    if 'shared' in data:
        t.shared = bool(data['shared'])
    if 'data' in data:
        t.data = json.dumps(_clean_template_data(data['data'] or {}))
    db.session.commit()
    return jsonify({'template': t.to_dict()})


@bp.delete('/templates/<int:template_id>')
@login_required
def delete_template(user, template_id):
    t = JobTemplate.query.get_or_404(template_id)
    if t.owner_id != user.id and not perm.is_super(user):
        return jsonify({'error': 'Only the owner can delete this template'}), 403
    db.session.delete(t)
    db.session.commit()
    return jsonify({'ok': True})


# ---- Trash bin (deleted jobs & boards, restorable for 30 days) ----

def _trash_scope(user):
    """None = all entries (super admin); a set of company ids otherwise."""
    if perm.is_super(user):
        return None
    if user.role == 'admin':
        return perm.managed_company_ids(user)
    if user.role == 'company_admin' and user.company_id:
        return {user.company_id}
    return set()


@bp.get('/trash')
@login_required
def list_trash(user):
    from ..models import TrashEntry
    scope = _trash_scope(user)
    if scope is not None and not scope:
        return jsonify({'error': 'Only admins can see the trash'}), 403
    q = TrashEntry.query.order_by(TrashEntry.deleted_at.desc())
    if scope is not None:
        q = q.filter(TrashEntry.company_id.in_(scope))
    return jsonify({'entries': [e.to_dict() for e in q.limit(200).all()]})


def _trash_entry_or_403(user, entry_id):
    from ..models import TrashEntry
    entry = TrashEntry.query.get_or_404(entry_id)
    scope = _trash_scope(user)
    if scope is not None and entry.company_id not in scope:
        return None
    return entry


@bp.post('/trash/<int:entry_id>/restore')
@login_required
def restore_trash(user, entry_id):
    from ..models import BoardGroup, TrashEntry  # noqa: F401
    from ..services import (broadcast_board, restore_board_snapshot,
                            restore_item_snapshot)
    entry = _trash_entry_or_403(user, entry_id)
    if entry is None:
        return jsonify({'error': 'No permission for this trash entry'}), 403
    snap = entry.payload_dict()
    if entry.kind == 'item':
        board = db.session.get(Board, snap.get('board_id'))
        if board is None:
            return jsonify({'error': 'The board this job lived on no longer '
                                     'exists — restore the board first'}), 400
        group = db.session.get(BoardGroup, snap.get('group_id'))
        if group is None or group.board_id != board.id:
            group = (BoardGroup.query.filter_by(board_id=board.id)
                     .order_by(BoardGroup.position).first())
        if group is None:
            return jsonify({'error': 'The board has no groups to restore into'}), 400
        it = restore_item_snapshot(snap, board, group)
        log_activity(user.id, board.id, it.id, 'item_created',
                     f'restored "{it.name}" from the trash')
        db.session.delete(entry)  # blobs are re-attached, keep them
        db.session.commit()
        broadcast_board(board.id)
        return jsonify({'restored': 'item', 'board_id': board.id, 'item_id': it.id})

    b = snap.get('board', {})
    dept = db.session.get(Department, b.get('department_id')) if b.get('department_id') else None
    company_id = b.get('company_id')
    if dept is None and company_id is None:
        company_id = entry.company_id
    if dept is None and (company_id is None or db.session.get(Company, company_id) is None):
        return jsonify({'error': 'The company/department this board belonged '
                                 'to no longer exists'}), 400
    board = restore_board_snapshot(snap, department_id=dept.id if dept else None,
                                   company_id=None if dept else company_id)
    log_activity(user.id, board.id, None, 'board_created',
                 f'restored board "{board.name}" from the trash',
                 company_id=entry.company_id)
    db.session.delete(entry)
    db.session.commit()
    broadcast_board(board.id)
    return jsonify({'restored': 'board', 'board_id': board.id})


@bp.delete('/trash/<int:entry_id>')
@login_required
def purge_trash(user, entry_id):
    from ..services import purge_trash_entry
    entry = _trash_entry_or_403(user, entry_id)
    if entry is None:
        return jsonify({'error': 'No permission for this trash entry'}), 403
    purge_trash_entry(entry)
    db.session.commit()
    return jsonify({'ok': True})
