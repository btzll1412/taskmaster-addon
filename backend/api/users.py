from flask import Blueprint, jsonify, request
from werkzeug.security import generate_password_hash

from ..auth import admin_required, login_required
from ..db import db
from ..models import User

bp = Blueprint('users', __name__, url_prefix='/api/users')


@bp.get('')
@login_required
def list_users(user):
    users = User.query.order_by(User.display_name).all()
    return jsonify({'users': [u.to_dict() for u in users]})


@bp.post('')
@admin_required
def create_user(admin):
    data = request.json or {}
    username = (data.get('username') or '').strip().lower()
    if not username:
        return jsonify({'error': 'Username is required'}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username already exists'}), 409
    password = data.get('password') or ''
    if password and len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400
    u = User(
        username=username,
        display_name=(data.get('display_name') or '').strip() or username,
        email=(data.get('email') or '').strip() or None,
        color=data.get('color') or '#579bfc',
        role='admin' if data.get('role') == 'admin' else 'member',
        password_hash=generate_password_hash(password) if password else None,
    )
    db.session.add(u)
    db.session.commit()
    return jsonify({'user': u.to_dict(include_private=True)}), 201


@bp.put('/<int:user_id>')
@admin_required
def update_user(admin, user_id):
    u = User.query.get_or_404(user_id)
    data = request.json or {}
    if 'display_name' in data and data['display_name'].strip():
        u.display_name = data['display_name'].strip()
    if 'color' in data:
        u.color = data['color']
    if 'email' in data:
        u.email = (data['email'] or '').strip() or None
    if 'role' in data:
        if u.id == admin.id and data['role'] != 'admin':
            return jsonify({'error': 'You cannot remove your own admin role'}), 400
        u.role = 'admin' if data['role'] == 'admin' else 'member'
    if 'is_active' in data:
        if u.id == admin.id and not data['is_active']:
            return jsonify({'error': 'You cannot deactivate yourself'}), 400
        u.is_active = bool(data['is_active'])
    db.session.commit()
    return jsonify({'user': u.to_dict(include_private=True)})


@bp.post('/<int:user_id>/password')
@admin_required
def set_password(admin, user_id):
    u = User.query.get_or_404(user_id)
    password = (request.json or {}).get('password') or ''
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400
    u.password_hash = generate_password_hash(password)
    db.session.commit()
    return jsonify({'ok': True})
