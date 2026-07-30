import time
from functools import wraps

from flask import jsonify, session

from .models import User

# Sessions are valid for a fixed 7 days from sign-in (not sliding):
# after that everyone re-authenticates, even if they used it every day.
SESSION_MAX_AGE = 7 * 24 * 60 * 60


def start_session(user):
    session.permanent = True
    session['user_id'] = user.id
    session['login_at'] = int(time.time())


def current_user():
    uid = session.get('user_id')
    if not uid:
        return None
    login_at = session.get('login_at')
    # hard 7-day cap from the moment of login; old sessions lack the
    # timestamp and are retired the same way
    if not login_at or time.time() - login_at > SESSION_MAX_AGE:
        session.pop('user_id', None)
        session.pop('login_at', None)
        return None
    user = User.query.get(uid)
    if user and user.is_active:
        return user
    return None


def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        return f(user, *args, **kwargs)
    return wrapper


def admin_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user:
            return jsonify({'error': 'Authentication required'}), 401
        if user.role != 'admin':
            return jsonify({'error': 'Admin access required'}), 403
        return f(user, *args, **kwargs)
    return wrapper
