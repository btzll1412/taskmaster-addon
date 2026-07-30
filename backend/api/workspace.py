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
    user_ids = [int(u) for u in (data.get('notify_user_ids') or [])]
    notify_assignees = bool(data.get('notify_assignees'))
    if not user_ids and not notify_assignees:
        return jsonify({'error': 'Pick people to notify (or the assigned people option)'}), 400
    label = (data.get('label_text') or '').strip() or None
    r = AutomationRule(
        company_id=company_id,
        name=(data.get('name') or '').strip() or (f'Notify when status becomes {label}' if label else 'Notify on status change'),
        label_text=label,
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
