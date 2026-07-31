import hashlib
import secrets
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from .. import permissions as perm
from ..auth import current_user, login_required, start_session
from ..db import db
from ..models import AuthToken, User

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


# ---- Email token flows: forgot password + invitations ----

TOKEN_LIFETIMES = {'reset': timedelta(hours=1), 'invite': timedelta(days=7)}


def _hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


def issue_token(user, kind):
    """Create a fresh single-use token, retiring any previous ones of the kind."""
    AuthToken.query.filter_by(user_id=user.id, kind=kind, used=False).update({'used': True})
    token = secrets.token_urlsafe(32)
    db.session.add(AuthToken(
        kind=kind, user_id=user.id, token_hash=_hash_token(token),
        expires_at=datetime.utcnow() + TOKEN_LIFETIMES[kind],
    ))
    return token


def consume_token(token, kind, mark_used=True):
    """Return the token's user if valid, else None."""
    if not token:
        return None
    row = AuthToken.query.filter_by(token_hash=_hash_token(token), kind=kind,
                                    used=False).first()
    if not row or row.expires_at < datetime.utcnow():
        return None
    user = db.session.get(User, row.user_id)
    if not user or not user.is_active:
        return None
    if mark_used:
        row.used = True
    return user


def _link_base():
    from .. import emailer
    base = (emailer.get_config().get('base_url') or '').strip()
    return base.rstrip('/') if base else request.host_url.rstrip('/')


@bp.post('/forgot')
def forgot_password():
    """Email a reset link. Always answers OK — never reveals whether the
    address belongs to an account."""
    from .. import emailer
    if not emailer.is_ready():
        return jsonify({'error': 'Password reset by email is not set up — ask your administrator'}), 400
    email = ((request.json or {}).get('email') or '').strip().lower()
    if not email:
        return jsonify({'error': 'Enter your email address'}), 400
    user = User.query.filter(db.func.lower(User.email) == email,
                             User.is_active.is_(True),
                             User.password_hash.isnot(None)).first()
    if user:
        token = issue_token(user, 'reset')
        db.session.commit()
        from flask import current_app
        emailer.send_async(
            current_app._get_current_object(), user.email,
            'Reset your TaskMaster password',
            f'Hi {user.display_name},\n\n'
            f'Someone (hopefully you) asked to reset your TaskMaster password.\n'
            f'Click the link below to choose a new one. The link works once and '
            f'expires in 1 hour.\n\n{_link_base()}/?reset={token}\n\n'
            f'If this wasn\'t you, you can ignore this email - nothing changes.')
    return jsonify({'ok': True, 'message': 'If that email belongs to an account, a reset link is on its way.'})


@bp.post('/reset')
def reset_password():
    data = request.json or {}
    new = data.get('new_password') or ''
    if len(new) < 6:
        return jsonify({'error': 'New password must be at least 6 characters'}), 400
    user = consume_token(data.get('token'), 'reset')
    if not user:
        return jsonify({'error': 'This reset link is invalid or has expired — request a new one'}), 400
    user.password_hash = generate_password_hash(new)
    user.must_change_password = False
    db.session.commit()
    start_session(user)
    return jsonify({'user': _user_payload(user)})


@bp.get('/invite-info')
def invite_info():
    """What the invite page shows before the person fills anything in."""
    user = consume_token(request.args.get('token'), 'invite', mark_used=False)
    if not user:
        return jsonify({'error': 'This invitation is invalid or has expired — ask for a new one'}), 404
    from ..models import Company
    company = db.session.get(Company, user.company_id) if user.company_id else None
    return jsonify({'invite': {
        'email': user.email,
        'company_name': company.name if company else None,
    }})


@bp.post('/accept-invite')
def accept_invite():
    data = request.json or {}
    username = (data.get('username') or '').strip().lower()
    display_name = (data.get('display_name') or '').strip()
    password = data.get('password') or ''
    if not username:
        return jsonify({'error': 'Pick a username'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400
    user = consume_token(data.get('token'), 'invite', mark_used=False)
    if not user:
        return jsonify({'error': 'This invitation is invalid or has expired — ask for a new one'}), 400
    taken = User.query.filter(User.username == username, User.id != user.id).first()
    if taken:
        return jsonify({'error': 'That username is taken — pick another'}), 409
    consume_token(data.get('token'), 'invite')  # mark used now that input is valid
    user.username = username
    user.display_name = display_name or username
    user.password_hash = generate_password_hash(password)
    user.must_change_password = False
    db.session.commit()
    start_session(user)
    return jsonify({'user': _user_payload(user)})


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
    if user.must_change_password:
        # a temporary password does NOT start a session — it only unlocks the
        # set-your-own-password step. Closing the tab lands back on login.
        return jsonify({
            'must_change_password': True,
            'user': {'username': user.username, 'display_name': user.display_name},
        })
    start_session(user)
    return jsonify({'user': _user_payload(user)})


@bp.post('/first-password')
def first_password():
    """Turn a temporary password into the user's own password. Runs without a
    session; the real session starts only after this succeeds."""
    data = request.json or {}
    username = (data.get('username') or '').strip().lower()
    temp = data.get('temp_password') or ''
    new = data.get('new_password') or ''
    user = User.query.filter_by(username=username).first()
    if not user or not user.is_active or not user.password_hash \
            or not check_password_hash(user.password_hash, temp):
        return jsonify({'error': 'The temporary password is incorrect'}), 401
    if not user.must_change_password:
        return jsonify({'error': 'This account has no pending password change — just sign in'}), 400
    if len(new) < 6:
        return jsonify({'error': 'New password must be at least 6 characters'}), 400
    if new == temp:
        return jsonify({'error': 'The new password must be different from the temporary one'}), 400
    user.password_hash = generate_password_hash(new)
    user.must_change_password = False
    db.session.commit()
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
    if 'email_notifications' in data:
        user.email_notifications = bool(data['email_notifications'])
    db.session.commit()
    return jsonify({'user': _user_payload(user)})
