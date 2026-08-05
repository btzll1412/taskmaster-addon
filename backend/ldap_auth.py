"""Active Directory / LDAP sign-in.

The super admin configures the server in Settings -> Directory. Login tries
local passwords first; unknown users (or users marked auth_source=ldap) are
then bound against the directory. First successful directory login creates
the TaskMaster account automatically with the configured default role."""
from .db import db
from .models import AppSetting, User

KEY = 'ldap_config'
DEFAULTS = {
    'enabled': False,
    'server': '',                 # ldap://dc1.company.local or ldaps://...
    'bind_template': '',          # '{username}@company.local' or 'COMPANY\\{username}'
    'default_role': 'viewer',     # role for auto-created accounts
    'default_company_id': None,   # company for auto-created accounts (None = IT staff)
}


def get_config():
    cfg = dict(DEFAULTS)
    cfg.update(AppSetting.get_json(KEY) or {})
    return cfg


def save_config(data):
    cfg = get_config()
    if 'enabled' in data:
        cfg['enabled'] = bool(data['enabled'])
    for k in ('server', 'bind_template', 'default_role'):
        if k in data:
            cfg[k] = str(data[k] or '').strip()
    if 'default_company_id' in data:
        cfg['default_company_id'] = int(data['default_company_id']) if data['default_company_id'] else None
    if cfg['default_role'] not in ('viewer', 'member', 'company_admin'):
        cfg['default_role'] = 'viewer'
    AppSetting.set_json(KEY, cfg)
    return cfg


def try_login(username, password):
    """Return a User on successful directory bind, else None. Never raises."""
    cfg = get_config()
    if not (cfg['enabled'] and cfg['server'] and cfg['bind_template'] and password):
        return None
    existing = User.query.filter_by(username=username).first()
    if existing and existing.auth_source != 'ldap':
        return None  # local accounts stay local
    try:
        from ldap3 import Connection, Server
        server = Server(cfg['server'], connect_timeout=8)
        bind_dn = cfg['bind_template'].replace('{username}', username)
        conn = Connection(server, user=bind_dn, password=password,
                          receive_timeout=8)
        if not conn.bind():
            return None
        conn.unbind()
    except Exception as e:  # noqa: BLE001 — any directory problem = normal login failure
        print(f'TaskMaster LDAP: {e}')
        return None
    if existing:
        return existing if existing.is_active else None
    user = User(username=username, display_name=username,
                role=cfg['default_role'], company_id=cfg['default_company_id'],
                auth_source='ldap', password_hash=None)
    db.session.add(user)
    db.session.commit()
    print(f'TaskMaster: created directory user {username}')
    return user
