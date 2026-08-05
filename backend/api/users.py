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
    if len(password) < 6:
        return jsonify({'error': 'A temporary password of at least 6 characters is required'}), 400
    email = (data.get('email') or '').strip().lower() or None
    if email and User.query.filter(db.func.lower(User.email) == email).first():
        return jsonify({'error': 'Another user already has this email address'}), 409

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
        email=email,
        color=data.get('color') or '#579bfc',
        role=role,
        custom_role_id=custom_role_id,
        company_id=company_id,
        password_hash=generate_password_hash(password),
        must_change_password=True,  # admin-set passwords are temporary
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


@bp.post('/invite')
@login_required
def invite_user(actor):
    """Create a user from just an email address: they get an invitation link
    and choose their own username, display name and password."""
    if not (actor.role in ('super_admin', 'admin', 'company_admin')
            or perm.has_cap(actor, perm.CAP_USERS)):
        return jsonify({'error': 'No permission to create users'}), 403
    from .. import emailer
    if not emailer.is_ready():
        return jsonify({'error': 'Set up the email service first (Settings → Email)'}), 400
    data = request.json or {}
    email = (data.get('email') or '').strip().lower()
    if not email or '@' not in email:
        return jsonify({'error': 'A valid email address is required'}), 400
    if User.query.filter(db.func.lower(User.email) == email).first():
        return jsonify({'error': 'A user with this email already exists'}), 409
    if User.query.filter_by(username=email).first():
        return jsonify({'error': 'A user with this email already exists'}), 409

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
        username=email,                      # placeholder until they pick one
        display_name=email.split('@')[0],
        email=email,
        role=role,
        custom_role_id=custom_role_id,
        company_id=company_id,
        password_hash=None,                  # cannot sign in until accepted
    )
    db.session.add(u)
    db.session.flush()
    if not company_id and role != 'super_admin':
        if data.get('all_companies') and perm.is_super(actor):
            db.session.add(AccessGrant(user_id=u.id, scope_type='all', scope_id=0,
                                       granted_by=actor.id))
        for cid in (data.get('company_ids') or []):
            if db.session.get(Company, cid) and perm.can_grant_in_company(actor, cid):
                db.session.add(AccessGrant(user_id=u.id, scope_type='company',
                                           scope_id=int(cid), granted_by=actor.id))
    log_activity(actor.id, None, None, 'user_created',
                 f'invited {email} by email', company_id=u.company_id)
    _send_invite(actor, u)
    db.session.commit()
    return jsonify({'user': u.to_dict(include_private=True)}), 201


@bp.post('/<int:user_id>/invite')
@login_required
def resend_invite(actor, user_id):
    """Send the invitation again (only for accounts still waiting to accept)."""
    u = User.query.get_or_404(user_id)
    if not perm.can_manage_user(actor, u):
        return jsonify({'error': 'No permission to manage this user'}), 403
    from .. import emailer
    if not emailer.is_ready():
        return jsonify({'error': 'Set up the email service first (Settings → Email)'}), 400
    if u.password_hash:
        return jsonify({'error': 'This user already finished setting up — use Reset password instead'}), 400
    if not u.email:
        return jsonify({'error': 'This user has no email address'}), 400
    _send_invite(actor, u)
    db.session.commit()
    return jsonify({'ok': True})


def _send_invite(actor, u):
    from flask import current_app
    from .. import emailer
    from .auth_routes import issue_token, _link_base
    token = issue_token(u, 'invite')
    emailer.send_async(
        current_app._get_current_object(), u.email,
        'You\'re invited to TaskMaster',
        f'Hi,\n\n{actor.display_name} invited you to TaskMaster.\n'
        f'Click the link below to choose your username and password - it takes a '
        f'minute. The link expires in 7 days.\n\n{_link_base()}/?invite={token}')


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
        new_email = (data['email'] or '').strip().lower() or None
        if new_email and User.query.filter(db.func.lower(User.email) == new_email,
                                           User.id != u.id).first():
            return jsonify({'error': 'Another user already has this email address'}), 409
        u.email = new_email
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


@bp.delete('/<int:user_id>')
@login_required
def delete_user(actor, user_id):
    """Permanently remove a user. Only the super admin, only for deactivated
    accounts (deactivate first — that's the reversible step). Their updates,
    files and history stay, shown as an unknown author; their access grants,
    notifications and assignments are cleaned out."""
    u = User.query.get_or_404(user_id)
    if not perm.is_super(actor):
        return jsonify({'error': 'Only the super admin can permanently delete users'}), 403
    if u.id == actor.id:
        return jsonify({'error': 'You cannot delete yourself'}), 400
    if u.is_active:
        return jsonify({'error': 'Deactivate the user first — deletion is permanent'}), 400

    import json as _json
    from ..models import AuthToken, BoardColumn, ItemValue, Notification
    AccessGrant.query.filter_by(user_id=u.id).delete(synchronize_session=False)
    AccessGrant.query.filter_by(granted_by=u.id).update({'granted_by': None}, synchronize_session=False)
    Notification.query.filter_by(user_id=u.id).delete(synchronize_session=False)
    AuthToken.query.filter_by(user_id=u.id).delete(synchronize_session=False)
    # scrub them out of every people column so jobs don't point at a ghost
    people_cols = [c.id for c in BoardColumn.query.filter_by(type='people').all()]
    if people_cols:
        for v in ItemValue.query.filter(ItemValue.column_id.in_(people_cols),
                                        ItemValue.value.contains('"user_ids"')).all():
            ids = v.value_dict().get('user_ids') or []
            if u.id in ids:
                v.value = _json.dumps({'user_ids': [x for x in ids if x != u.id]})
    log_activity(actor.id, None, None, 'user_deleted',
                 f'permanently deleted user {u.display_name} (@{u.username})',
                 company_id=u.company_id)
    db.session.delete(u)
    db.session.commit()
    return jsonify({'ok': True})


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
    # admins hand out temporary passwords; owners keep their own
    u.must_change_password = u.id != actor.id
    db.session.commit()
    return jsonify({'ok': True})
