"""Outgoing email via the SMTP server the super admin configures in Settings.

Notification emails are sent on a background thread so API requests never
wait on an SMTP server. Uses only the standard library — nothing extra to
install inside the add-on."""
import smtplib
import threading
from email.message import EmailMessage
from email.utils import formataddr

from .models import AppSetting

SETTINGS_KEY = 'email_smtp'
DEFAULTS = {
    'enabled': False,
    'host': '',
    'port': 587,
    'security': 'starttls',   # starttls | ssl | none
    'username': '',
    'password': '',
    'from_name': 'TaskMaster',
    'from_addr': '',
    'base_url': '',           # optional portal address for links in emails
}


def get_config():
    cfg = dict(DEFAULTS)
    cfg.update(AppSetting.get_json(SETTINGS_KEY) or {})
    return cfg


def public_config():
    """Config safe to show in the UI: never returns the password."""
    cfg = get_config()
    pw = cfg.pop('password', '')
    cfg['has_password'] = bool(pw)
    return cfg


def save_config(data):
    cfg = get_config()
    for key in ('enabled',):
        if key in data:
            cfg[key] = bool(data[key])
    for key in ('host', 'security', 'username', 'from_name', 'from_addr', 'base_url'):
        if key in data:
            cfg[key] = str(data[key] or '').strip()
    if 'port' in data:
        try:
            cfg['port'] = max(1, min(65535, int(data['port'])))
        except (TypeError, ValueError):
            pass
    # an empty password field in the form means "keep the saved one"
    if data.get('password'):
        cfg['password'] = str(data['password'])
    if cfg['security'] not in ('starttls', 'ssl', 'none'):
        cfg['security'] = 'starttls'
    AppSetting.set_json(SETTINGS_KEY, cfg)
    return cfg


def is_ready(cfg=None):
    cfg = cfg or get_config()
    return bool(cfg['enabled'] and cfg['host'] and cfg['from_addr'])


def send_email(to, subject, body, cfg=None):
    """Send synchronously. Returns None on success, an error string on failure."""
    cfg = cfg or get_config()
    if not is_ready(cfg):
        return 'Email service is not configured'
    msg = EmailMessage()
    msg['Subject'] = subject
    msg['From'] = formataddr((cfg['from_name'] or 'TaskMaster', cfg['from_addr']))
    msg['To'] = to
    if cfg.get('base_url'):
        body = f"{body}\n\nOpen TaskMaster: {cfg['base_url'].rstrip('/')}"
    msg.set_content(body)
    try:
        if cfg['security'] == 'ssl':
            server = smtplib.SMTP_SSL(cfg['host'], cfg['port'], timeout=15)
        else:
            server = smtplib.SMTP(cfg['host'], cfg['port'], timeout=15)
        with server:
            if cfg['security'] == 'starttls':
                server.starttls()
            if cfg['username']:
                server.login(cfg['username'], cfg['password'])
            server.send_message(msg)
        return None
    except Exception as e:  # noqa: BLE001 — surface any SMTP problem as text
        return str(e)


def send_async(app, to, subject, body):
    """Fire-and-forget email for notifications; never blocks a request."""
    cfg = get_config()
    if not is_ready(cfg) or not to:
        return

    def worker():
        with app.app_context():
            err = send_email(to, subject, body, cfg)
            if err:
                print(f'TaskMaster: email to {to} failed: {err}')

    threading.Thread(target=worker, daemon=True).start()
