from flask import Blueprint, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from .. import permissions as perm
from ..auth import current_user, login_required, start_session
from ..db import db
from ..models import User

bp = Blueprint('auth', __name__, url_prefix='/api/auth')


def _setup_required():
    return User.query.filter(User.password_hash.isnot(None)).first() is None


# What the login screen says — the super admin can rewrite all of it
DEFAULT_BRANDING = {
    'title': 'TaskMaster',
    'tagline': 'Jobs, boards and teams — one portal for you and your customers.',
    'features': [
        {'icon': '📋', 'text': 'Track every job and sub-task, live'},
        {'icon': '🔔', 'text': 'Automatic notifications on status changes'},
    ],
    'foot': 'Runs locally on your own server',
    'welcome': 'Welcome back',
    'welcome_sub': 'Sign in to your workspace',
}


def _branding():
    from ..models import AppSetting
    saved = AppSetting.get_json('login_branding') or {}
    out = dict(DEFAULT_BRANDING)
    for k in out:
        if k in saved:
            out[k] = saved[k]
    return out


def _clean_branding(data):
    def s(v, n=300):
        return str(v or '').strip()[:n]
    features = []
    for f in (data.get('features') or [])[:8]:
        if isinstance(f, dict) and s(f.get('text')):
            features.append({'icon': s(f.get('icon'), 8) or '•', 'text': s(f.get('text'))})
    return {
        'title': s(data.get('title'), 60) or 'TaskMaster',
        'tagline': s(data.get('tagline')),
        'features': features,
        'foot': s(data.get('foot'), 120),
        'welcome': s(data.get('welcome'), 80) or 'Welcome back',
        'welcome_sub': s(data.get('welcome_sub'), 120),
    }


@bp.get('/branding')
def get_branding():
    """Public: the login screen loads before anyone is signed in."""
    return jsonify({'branding': _branding()})


@bp.put('/branding')
@login_required
def update_branding(user):
    if not perm.is_super(user):
        return jsonify({'error': 'Only the super admin can change the login screen'}), 403
    from ..models import AppSetting
    AppSetting.set_json('login_branding', _clean_branding(request.json or {}))
    db.session.commit()
    return jsonify({'branding': _branding()})


def _user_payload(user):
    d = user.to_dict(include_private=True)
    d['capabilities'] = sorted(perm.caps(user))
    return d


@bp.get('/status')
def status():
    user = current_user()
    return jsonify({
        'setup_required': _setup_required(),
        'authenticated': user is not None,
        'user': _user_payload(user) if user else None,
        'branding': _branding(),
    })


@bp.post('/setup')
def setup():
    """First-run: create the initial admin account."""
    if not _setup_required():
        return jsonify({'error': 'Setup already completed'}), 403
    data = request.json or {}
    username = (data.get('username') or '').strip().lower()
    password = data.get('password') or ''
    display_name = (data.get('display_name') or '').strip() or username
    if not username or len(password) < 6:
        return jsonify({'error': 'Username and a password of at least 6 characters are required'}), 400

    # If the username matches a migrated v2 user, upgrade that account to admin
    user = User.query.filter_by(username=username).first()
    if user is None:
        user = User(username=username, display_name=display_name)
        db.session.add(user)
    user.display_name = display_name
    user.role = 'super_admin'
    user.is_active = True
    user.password_hash = generate_password_hash(password)
    db.session.commit()

    start_session(user)
    return jsonify({'user': _user_payload(user)})


@bp.post('/login')
def login():
    data = request.json or {}
    username = (data.get('username') or '').strip().lower()
    password = data.get('password') or ''
    user = User.query.filter_by(username=username).first()
    if not user or not user.is_active or not user.password_hash \
            or not check_password_hash(user.password_hash, password):
        return jsonify({'error': 'Invalid username or password'}), 401
    start_session(user)
    return jsonify({'user': _user_payload(user)})


@bp.post('/logout')
def logout():
    session.pop('user_id', None)
    return jsonify({'ok': True})


@bp.post('/password')
@login_required
def change_password(user):
    data = request.json or {}
    current = data.get('current_password') or ''
    new = data.get('new_password') or ''
    if not check_password_hash(user.password_hash or '', current):
        return jsonify({'error': 'Current password is incorrect'}), 400
    if len(new) < 6:
        return jsonify({'error': 'New password must be at least 6 characters'}), 400
    if new == current:
        return jsonify({'error': 'The new password must be different from the temporary one'
                        if user.must_change_password else
                        'The new password must be different from the current one'}), 400
    user.password_hash = generate_password_hash(new)
    user.must_change_password = False
    db.session.commit()
    return jsonify({'ok': True, 'user': _user_payload(user)})


@bp.put('/profile')
@login_required
def update_profile(user):
    data = request.json or {}
    if 'display_name' in data and data['display_name'].strip():
        user.display_name = data['display_name'].strip()
    if 'color' in data:
        user.color = data['color']
    if 'email' in data:
        user.email = data['email'].strip() or None
    if 'hide_done' in data:
        user.hide_done = bool(data['hide_done'])
    db.session.commit()
    return jsonify({'user': _user_payload(user)})
