from flask import Blueprint, jsonify, request
from werkzeug.security import generate_password_hash

from .. import permissions as perm
from ..auth import login_required
from ..db import db
from ..models import AccessGrant, Company, Role, User
from ..services import log_activity

bp = Blueprint('users', __name__, url_prefix='/api/users')

COMPANY_LEVELS = ('company_admin', 'member', 'viewer')
STAFF_LEVELS = ('super_admin', 'admin', 'member', 'viewer')


def _resolve_role(actor, company_id, role, custom_role_id):
    """Validate the requested role for the target's home (company vs IT staff).
    Returns (role, custom_role_id) or an error string."""
    if custom_role_id:
        r = db.session.get(Role, custom_role_id)
        if not r:
            return 'Custom role not found'
        # universal roles: base level derives from the role's capabilities
        base = 'member' if r.permission_list() else 'viewer'
        return (base, r.id)
    if company_id:
        if role not in COMPANY_LEVELS:
            return 'Company users can be: company admin, member, or viewer'
    else:
        if role not in STAFF_LEVELS:
            return 'IT staff can be: super admin, admin, member, or viewer'
        if role in ('super_admin', 'admin') and not perm.is_super(actor):
            return 'Only super admins can create admin-level staff'
    return (role, None)


@bp.get('')
@login_required
def list_users(user):
    users = perm.visible_users(user)
    companies = {c.id: c.name for c in Company.query.all()}
    role_names = {r.id: r.name for r in Role.query.all()}
    out = []
    for u in users:
        d = u.to_dict(include_private=perm.can_manage_user(user, u))
        d['company_name'] = companies.get(u.company_id)
        d['role_name'] = role_names.get(u.custom_role_id)
        out.append(d)
    return jsonify({'users': out})


@bp.post('')
@login_required
def create_user(actor):
    if not (actor.role in ('super_admin', 'admin', 'company_admin')
            or perm.has_cap(actor, perm.CAP_USERS)):
        return jsonify({'error': 'No permission to create users'}), 403
    data = request.json or {}
    username = (data.get('username') or '').strip().lower()
    if not username:
        return jsonify({'error': 'Username is required'}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username already exists'}), 409
    password = data.get('password') or ''
    if password and len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400

    company_id = data.get('company_id') or None
    if perm.is_super(actor):
        if company_id and not db.session.get(Company, company_id):
            return jsonify({'error': 'Company not found'}), 404
    elif actor.role == 'admin':
        if not company_id or company_id not in perm.managed_company_ids(actor):
            return jsonify({'error': 'You can only create users in companies you manage'}), 403
    else:
        company_id = actor.company_id

    resolved = _resolve_role(actor, company_id,
                             data.get('role') or 'member', data.get('custom_role_id'))
    if isinstance(resolved, str):
        return jsonify({'error': resolved}), 400
    role, custom_role_id = resolved

    u = User(
        username=username,
        display_name=(data.get('display_name') or '').strip() or username,
        email=(data.get('email') or '').strip() or None,
        color=data.get('color') or '#579bfc',
        role=role,
        custom_role_id=custom_role_id,
        company_id=company_id,
        password_hash=generate_password_hash(password) if password else None,
    )
    db.session.add(u)
    db.session.flush()

    # IT staff site access: all companies or a specific list
    if not company_id and role != 'super_admin':
        if data.get('all_companies') and perm.is_super(actor):
            db.session.add(AccessGrant(user_id=u.id, scope_type='all', scope_id=0,
                                       granted_by=actor.id))
        for cid in (data.get('company_ids') or []):
            if db.session.get(Company, cid) and perm.can_grant_in_company(actor, cid):
                db.session.add(AccessGrant(user_id=u.id, scope_type='company',
                                           scope_id=int(cid), granted_by=actor.id))
    log_activity(actor.id, None, None, 'user_created',
                 f'created user {u.display_name} (@{u.username})', company_id=u.company_id)
    db.session.commit()
    return jsonify({'user': u.to_dict(include_private=True)}), 201


@bp.put('/<int:user_id>')
@login_required
def update_user(actor, user_id):
    u = User.query.get_or_404(user_id)
    if not perm.can_manage_user(actor, u):
        return jsonify({'error': 'No permission to manage this user'}), 403
    data = request.json or {}
    if 'display_name' in data and data['display_name'].strip():
        u.display_name = data['display_name'].strip()
    if 'color' in data:
        u.color = data['color']
    if 'email' in data:
        u.email = (data['email'] or '').strip() or None
    if 'company_id' in data and perm.is_super(actor):
        cid = data['company_id'] or None
        if cid and not db.session.get(Company, cid):
            return jsonify({'error': 'Company not found'}), 404
        u.company_id = cid
    if 'role' in data or 'custom_role_id' in data:
        if u.id == actor.id:
            return jsonify({'error': 'You cannot change your own role'}), 400
        old_role = u.role
        resolved = _resolve_role(actor, u.company_id,
                                 data.get('role') or u.role, data.get('custom_role_id'))
        if isinstance(resolved, str):
            return jsonify({'error': resolved}), 400
        u.role, u.custom_role_id = resolved
        if u.role != old_role or 'custom_role_id' in data:
            log_activity(actor.id, None, None, 'user_role_changed',
                         f'changed {u.display_name}\'s role to {u.role}',
                         company_id=u.company_id)
    if 'is_active' in data:
        if u.id == actor.id and not data['is_active']:
            return jsonify({'error': 'You cannot deactivate yourself'}), 400
        if bool(data['is_active']) != bool(u.is_active):
            log_activity(actor.id, None, None,
                         'user_activated' if data['is_active'] else 'user_deactivated',
                         f'{"reactivated" if data["is_active"] else "deactivated"} user {u.display_name} (@{u.username})',
                         company_id=u.company_id)
        u.is_active = bool(data['is_active'])
    db.session.commit()
    return jsonify({'user': u.to_dict(include_private=True)})


@bp.post('/<int:user_id>/password')
@login_required
def set_password(actor, user_id):
    u = User.query.get_or_404(user_id)
    if not perm.can_manage_user(actor, u):
        return jsonify({'error': 'No permission to manage this user'}), 403
    password = (request.json or {}).get('password') or ''
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400
    u.password_hash = generate_password_hash(password)
    db.session.commit()
    return jsonify({'ok': True})
