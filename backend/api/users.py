from flask import Blueprint, jsonify, request
from werkzeug.security import generate_password_hash

from .. import permissions as perm
from ..auth import login_required
from ..db import db
from ..models import Company, User

bp = Blueprint('users', __name__, url_prefix='/api/users')

ROLES = ('super_admin', 'company_admin', 'member')


@bp.get('')
@login_required
def list_users(user):
    users = perm.visible_users(user)
    companies = {c.id: c.name for c in Company.query.all()}
    out = []
    for u in users:
        d = u.to_dict(include_private=perm.can_manage_user(user, u))
        d['company_name'] = companies.get(u.company_id)
        out.append(d)
    return jsonify({'users': out})


@bp.post('')
@login_required
def create_user(actor):
    if actor.role not in ('super_admin', 'company_admin'):
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

    role = data.get('role') if data.get('role') in ROLES else 'member'
    company_id = data.get('company_id') or None
    if perm.is_super(actor):
        if company_id and not db.session.get(Company, company_id):
            return jsonify({'error': 'Company not found'}), 404
    else:
        # company admins create accounts only inside their own company
        company_id = actor.company_id
        if role == 'super_admin':
            role = 'member'

    u = User(
        username=username,
        display_name=(data.get('display_name') or '').strip() or username,
        email=(data.get('email') or '').strip() or None,
        color=data.get('color') or '#579bfc',
        role=role,
        company_id=company_id,
        password_hash=generate_password_hash(password) if password else None,
    )
    db.session.add(u)
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
    if 'role' in data and data['role'] in ROLES:
        if u.id == actor.id and data['role'] != actor.role:
            return jsonify({'error': 'You cannot change your own role'}), 400
        if data['role'] == 'super_admin' and not perm.is_super(actor):
            return jsonify({'error': 'Only super admins can promote to super admin'}), 403
        u.role = data['role']
    if 'is_active' in data:
        if u.id == actor.id and not data['is_active']:
            return jsonify({'error': 'You cannot deactivate yourself'}), 400
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
