"""TaskMaster v3 backend package."""
import os
import secrets

from flask import Flask, jsonify, send_from_directory

from .config import DATA_DIR, WEB_DIST
from .db import db


def _load_secret_key():
    """Persist a random secret key in the data dir so sessions survive restarts."""
    path = os.path.join(DATA_DIR, '.secret_key')
    try:
        if os.path.exists(path):
            with open(path) as f:
                key = f.read().strip()
                if key:
                    return key
        key = secrets.token_hex(32)
        with open(path, 'w') as f:
            f.write(key)
        os.chmod(path, 0o600)
        return key
    except OSError:
        return secrets.token_hex(32)


def create_app():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(os.path.join(DATA_DIR, 'uploads'), exist_ok=True)

    app = Flask(__name__, static_folder=None)
    app.config['SECRET_KEY'] = _load_secret_key()
    app.config['SQLALCHEMY_DATABASE_URI'] = f"sqlite:///{os.path.join(DATA_DIR, 'taskmaster.db')}"
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['MAX_CONTENT_LENGTH'] = 32 * 1024 * 1024
    app.config['SESSION_COOKIE_HTTPONLY'] = True
    app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
    app.config['PERMANENT_SESSION_LIFETIME'] = 60 * 60 * 24 * 7  # fixed 7 days
    # do NOT refresh the cookie on every request — the 7 days count from
    # login, they don't slide with activity
    app.config['SESSION_REFRESH_EACH_REQUEST'] = False

    # No CORS on purpose: the frontend is served by this same server, so no
    # other origin ever needs credentialed API access.
    db.init_app(app)

    from . import models  # noqa: F401  (register models)
    with app.app_context():
        db.create_all()
        from .migrate_v4 import ensure_schema, migrate_v4_data
        ensure_schema()  # column additions must precede any ORM queries
        from .migrate_v2 import migrate_v2_if_needed
        migrate_v2_if_needed()
        migrate_v4_data()

    from .api import register_blueprints
    register_blueprints(app)

    from .scheduler import start_scheduler
    start_scheduler(app)

    @app.before_request
    def api_guards():
        from flask import request
        if not request.path.startswith('/api'):
            return None
        from .auth import current_user
        from . import permissions as perm
        u = current_user()  # never returns a user with a pending temp password
        if request.method not in ('POST', 'PUT', 'DELETE', 'PATCH'):
            return None
        # viewers may still authenticate, manage session basics, and submit requests
        for allowed in ('/api/auth/', '/api/notifications/read', '/api/requests'):
            if request.path.startswith(allowed):
                return None
        if u and not perm.can_write(u):
            return jsonify({'error': 'Your role is view-only'}), 403
        return None

    @app.route('/')
    def index():
        return send_from_directory(WEB_DIST, 'index.html')

    @app.route('/<path:path>')
    def static_files(path):
        full = os.path.join(WEB_DIST, path)
        if os.path.isfile(full):
            return send_from_directory(WEB_DIST, path)
        return send_from_directory(WEB_DIST, 'index.html')

    return app
