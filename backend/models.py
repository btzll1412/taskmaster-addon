import json
from datetime import datetime

from .db import db


def utcnow():
    return datetime.utcnow()


class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(300))
    display_name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(200))
    color = db.Column(db.String(7), default='#579bfc')
    # super_admin: everything | admin: IT staff managing granted companies
    # company_admin: full access to own company | member: explicit grants only
    # viewer: like member but read-only
    role = db.Column(db.String(20), default='member')
    custom_role_id = db.Column(db.Integer, db.ForeignKey('roles.id'))
    company_id = db.Column(db.Integer, db.ForeignKey('companies.id'))
    auth_source = db.Column(db.String(20), default='local')  # local (ldap planned)
    hide_done = db.Column(db.Boolean, default=False)  # personal preference
    # set when an admin gives them a (temporary) password; forces a change on next login
    must_change_password = db.Column(db.Boolean, default=False)
    email_notifications = db.Column(db.Boolean, default=True)  # mail me my notifications
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=utcnow)

    def to_dict(self, include_private=False):
        d = {
            'id': self.id,
            'username': self.username,
            'display_name': self.display_name,
            'color': self.color,
            'role': self.role,
            'custom_role_id': self.custom_role_id,
            'company_id': self.company_id,
            'is_active': self.is_active,
            'hide_done': bool(self.hide_done),
            'must_change_password': bool(self.must_change_password),
            'email_notifications': self.email_notifications is None or bool(self.email_notifications),
            'has_password': bool(self.password_hash),
            'initials': ''.join(w[0] for w in self.display_name.split()[:2]).upper() or '?',
        }
        if include_private:
            d['email'] = self.email
        return d


class Board(db.Model):
    __tablename__ = 'boards'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, default='')
    icon = db.Column(db.String(16), default='📋')
    color = db.Column(db.String(7), default='#579bfc')
    position = db.Column(db.Float, default=0)
    department_id = db.Column(db.Integer, db.ForeignKey('departments.id'))
    company_id = db.Column(db.Integer, db.ForeignKey('companies.id'))  # direct-under-company boards
    owner_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    archived = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description or '',
            'icon': self.icon or '📋',
            'color': self.color,
            'position': self.position,
            'department_id': self.department_id,
            'company_id': self.company_id,
            'owner_id': self.owner_id,
            'archived': self.archived,
            'created_at': iso(self.created_at),
            'updated_at': iso(self.updated_at),
        }


class BoardGroup(db.Model):
    __tablename__ = 'board_groups'
    id = db.Column(db.Integer, primary_key=True)
    board_id = db.Column(db.Integer, db.ForeignKey('boards.id', ondelete='CASCADE'), nullable=False)
    name = db.Column(db.String(200), nullable=False)
    color = db.Column(db.String(7), default='#579bfc')
    position = db.Column(db.Float, default=0)
    collapsed = db.Column(db.Boolean, default=False)

    def to_dict(self):
        return {
            'id': self.id,
            'board_id': self.board_id,
            'name': self.name,
            'color': self.color,
            'position': self.position,
            'collapsed': self.collapsed,
        }


class BoardColumn(db.Model):
    __tablename__ = 'board_columns'
    id = db.Column(db.Integer, primary_key=True)
    board_id = db.Column(db.Integer, db.ForeignKey('boards.id', ondelete='CASCADE'), nullable=False)
    title = db.Column(db.String(120), nullable=False)
    # status | text | people | date | number | dropdown | checkbox
    type = db.Column(db.String(30), nullable=False)
    settings = db.Column(db.Text, default='{}')
    position = db.Column(db.Float, default=0)
    width = db.Column(db.Integer, default=140)

    def settings_dict(self):
        try:
            return json.loads(self.settings or '{}')
        except ValueError:
            return {}

    def to_dict(self):
        return {
            'id': self.id,
            'board_id': self.board_id,
            'title': self.title,
            'type': self.type,
            'settings': self.settings_dict(),
            'position': self.position,
            'width': self.width,
        }


class Item(db.Model):
    __tablename__ = 'items'
    id = db.Column(db.Integer, primary_key=True)
    board_id = db.Column(db.Integer, db.ForeignKey('boards.id', ondelete='CASCADE'), nullable=False)
    group_id = db.Column(db.Integer, db.ForeignKey('board_groups.id', ondelete='CASCADE'), nullable=False)
    parent_id = db.Column(db.Integer, db.ForeignKey('items.id', ondelete='CASCADE'))
    name = db.Column(db.String(500), nullable=False)
    position = db.Column(db.Float, default=0)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'))
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        db.Index('idx_items_board', 'board_id'),
        db.Index('idx_items_group', 'group_id'),
    )

    def to_dict(self, values=None, counts=None):
        d = {
            'id': self.id,
            'board_id': self.board_id,
            'group_id': self.group_id,
            'parent_id': self.parent_id,
            'name': self.name,
            'position': self.position,
            'created_by': self.created_by,
            'created_at': iso(self.created_at),
            'updated_at': iso(self.updated_at),
        }
        if values is not None:
            d['values'] = values
        if counts is not None:
            d['updates_count'] = counts.get('updates', 0)
            d['files_count'] = counts.get('files', 0)
        return d


class ItemValue(db.Model):
    __tablename__ = 'item_values'
    id = db.Column(db.Integer, primary_key=True)
    item_id = db.Column(db.Integer, db.ForeignKey('items.id', ondelete='CASCADE'), nullable=False)
    column_id = db.Column(db.Integer, db.ForeignKey('board_columns.id', ondelete='CASCADE'), nullable=False)
    value = db.Column(db.Text, default='{}')

    __table_args__ = (
        db.UniqueConstraint('item_id', 'column_id', name='uq_item_column'),
        db.Index('idx_values_item', 'item_id'),
        db.Index('idx_values_column', 'column_id'),
    )

    def value_dict(self):
        try:
            return json.loads(self.value or '{}')
        except ValueError:
            return {}


class ItemUpdate(db.Model):
    __tablename__ = 'item_updates'
    id = db.Column(db.Integer, primary_key=True)
    item_id = db.Column(db.Integer, db.ForeignKey('items.id', ondelete='CASCADE'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    body = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (db.Index('idx_updates_item', 'item_id'),)

    def to_dict(self):
        return {
            'id': self.id,
            'item_id': self.item_id,
            'user_id': self.user_id,
            'body': self.body,
            'created_at': iso(self.created_at),
            'updated_at': iso(self.updated_at),
        }


class FileAsset(db.Model):
    __tablename__ = 'file_assets'
    id = db.Column(db.Integer, primary_key=True)
    item_id = db.Column(db.Integer, db.ForeignKey('items.id', ondelete='CASCADE'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    filename = db.Column(db.String(500), nullable=False)  # stored name on disk
    original_filename = db.Column(db.String(500), nullable=False)
    mime_type = db.Column(db.String(100))
    file_size = db.Column(db.Integer)
    created_at = db.Column(db.DateTime, default=utcnow)

    __table_args__ = (db.Index('idx_files_item', 'item_id'),)

    def to_dict(self):
        return {
            'id': self.id,
            'item_id': self.item_id,
            'user_id': self.user_id,
            'original_filename': self.original_filename,
            'mime_type': self.mime_type,
            'file_size': self.file_size,
            'created_at': iso(self.created_at),
            'is_image': (self.mime_type or '').startswith('image/'),
        }


class Activity(db.Model):
    __tablename__ = 'activity'
    id = db.Column(db.Integer, primary_key=True)
    board_id = db.Column(db.Integer, db.ForeignKey('boards.id', ondelete='CASCADE'))
    item_id = db.Column(db.Integer)
    company_id = db.Column(db.Integer)  # audit scoping; survives board deletion
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    action = db.Column(db.String(50), nullable=False)
    description = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow)

    # Index names must not collide with the v2 indexes that may still exist in
    # the same SQLite file (idx_activity_* on the old activity_log table).
    __table_args__ = (
        db.Index('idx_v3_activity_board', 'board_id'),
        db.Index('idx_v3_activity_item', 'item_id'),
        db.Index('idx_v3_activity_created', 'created_at'),
    )

    def to_dict(self):
        return {
            'id': self.id,
            'board_id': self.board_id,
            'item_id': self.item_id,
            'company_id': self.company_id,
            'user_id': self.user_id,
            'action': self.action,
            'description': self.description,
            'created_at': iso(self.created_at),
        }


class Notification(db.Model):
    __tablename__ = 'notifications'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    actor_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    type = db.Column(db.String(50), nullable=False)  # assigned | update | status
    board_id = db.Column(db.Integer)
    item_id = db.Column(db.Integer)
    message = db.Column(db.Text, nullable=False)
    read = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=utcnow)

    __table_args__ = (db.Index('idx_notifications_user', 'user_id', 'read'),)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'actor_id': self.actor_id,
            'type': self.type,
            'board_id': self.board_id,
            'item_id': self.item_id,
            'message': self.message,
            'read': self.read,
            'created_at': iso(self.created_at),
        }


class Role(db.Model):
    """Universal named role carrying a set of permission capabilities."""
    __tablename__ = 'roles'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False)
    level = db.Column(db.String(20), nullable=False, default='member')  # legacy
    permissions = db.Column(db.Text, default='[]')  # list of capability keys
    company_id = db.Column(db.Integer, db.ForeignKey('companies.id', ondelete='CASCADE'))  # legacy
    created_at = db.Column(db.DateTime, default=utcnow)

    def permission_list(self):
        try:
            perms = json.loads(self.permissions or '[]')
        except ValueError:
            perms = []
        if perms:
            return perms
        # roles created before capabilities existed fall back to their level
        legacy = {
            'admin': ['create_jobs', 'edit_jobs', 'manage_boards', 'manage_users',
                      'manage_access', 'manage_company'],
            'company_admin': ['create_jobs', 'edit_jobs', 'manage_boards', 'manage_users',
                              'manage_access', 'manage_company'],
            'member': ['create_jobs', 'edit_jobs', 'manage_boards'],
            'viewer': [],
        }
        return legacy.get(self.level, [])

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'permissions': self.permission_list(),
            'company_id': self.company_id,
        }


class Company(db.Model):
    __tablename__ = 'companies'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    color = db.Column(db.String(7), default='#0073ea')
    position = db.Column(db.Float, default=0)
    address = db.Column(db.Text)
    phone = db.Column(db.String(60))
    phone2 = db.Column(db.String(60))
    email = db.Column(db.String(200))
    contact_name = db.Column(db.String(200))
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'color': self.color,
            'position': self.position,
            'address': self.address or '',
            'phone': self.phone or '',
            'phone2': self.phone2 or '',
            'email': self.email or '',
            'contact_name': self.contact_name or '',
            'notes': self.notes or '',
        }


class Department(db.Model):
    __tablename__ = 'departments'
    id = db.Column(db.Integer, primary_key=True)
    company_id = db.Column(db.Integer, db.ForeignKey('companies.id', ondelete='CASCADE'), nullable=False)
    name = db.Column(db.String(200), nullable=False)
    icon = db.Column(db.String(16), default='🏢')
    position = db.Column(db.Float, default=0)

    def to_dict(self):
        return {
            'id': self.id,
            'company_id': self.company_id,
            'name': self.name,
            'icon': self.icon or '🏢',
            'position': self.position,
        }


class AccessGrant(db.Model):
    """Explicit access for a user: an entire company, a department, a board, or a single item."""
    __tablename__ = 'access_grants'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    scope_type = db.Column(db.String(20), nullable=False)  # company | department | board | item
    scope_id = db.Column(db.Integer, nullable=False)
    granted_by = db.Column(db.Integer, db.ForeignKey('users.id'))
    created_at = db.Column(db.DateTime, default=utcnow)

    __table_args__ = (
        db.UniqueConstraint('user_id', 'scope_type', 'scope_id', name='uq_grant'),
        db.Index('idx_grants_user', 'user_id'),
    )

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'scope_type': self.scope_type,
            'scope_id': self.scope_id,
            'granted_by': self.granted_by,
            'created_at': iso(self.created_at),
        }


class NotificationRule(db.Model):
    """Per-board rule: when <column> changes to <label>, notify <users>."""
    __tablename__ = 'notification_rules'
    id = db.Column(db.Integer, primary_key=True)
    board_id = db.Column(db.Integer, db.ForeignKey('boards.id', ondelete='CASCADE'), nullable=False)
    column_id = db.Column(db.Integer, db.ForeignKey('board_columns.id', ondelete='CASCADE'), nullable=False)
    label_id = db.Column(db.String(40))  # null = any status change on this column
    user_ids = db.Column(db.Text, default='[]')
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'))
    created_at = db.Column(db.DateTime, default=utcnow)

    __table_args__ = (db.Index('idx_rules_board', 'board_id'),)

    def user_id_list(self):
        try:
            return json.loads(self.user_ids or '[]')
        except ValueError:
            return []

    def to_dict(self):
        return {
            'id': self.id,
            'board_id': self.board_id,
            'column_id': self.column_id,
            'label_id': self.label_id,
            'user_ids': self.user_id_list(),
            'created_by': self.created_by,
        }


class JobTemplate(db.Model):
    """Reusable pre-configured job: default field values + a list of sub-tasks.
    Owned by its creator; `shared` publishes it for everyone to use."""
    __tablename__ = 'job_templates'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    icon = db.Column(db.String(16), default='📦')
    owner_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    shared = db.Column(db.Boolean, default=False)
    # {'values': [{'title','type','label'|'text'|'number'|...}], 'subtasks': [{'name'}]}
    data = db.Column(db.Text, default='{}')
    created_at = db.Column(db.DateTime, default=utcnow)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow)

    def data_dict(self):
        try:
            return json.loads(self.data or '{}')
        except ValueError:
            return {}

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'icon': self.icon or '📦',
            'owner_id': self.owner_id,
            'shared': bool(self.shared),
            'data': self.data_dict(),
            'created_at': iso(self.created_at),
        }


class AutomationRule(db.Model):
    """Central automation: when a status/priority value becomes <label>, notify people.
    company_id NULL = global (super admin) rule applied to every company; a company
    can opt out of a global rule via disabled_company_ids."""
    __tablename__ = 'automation_rules'
    id = db.Column(db.Integer, primary_key=True)
    company_id = db.Column(db.Integer, db.ForeignKey('companies.id', ondelete='CASCADE'))
    name = db.Column(db.String(200), nullable=False, default='')
    trigger = db.Column(db.String(20), default='status')  # status | created | overdue
    label_text = db.Column(db.String(120))  # status trigger: match label text; NULL = any
    action = db.Column(db.String(20), default='notify')   # notify | set_status | assign
    action_param = db.Column(db.String(200))              # set_status: label text; assign: user id
    notify_user_ids = db.Column(db.Text, default='[]')
    notify_assignees = db.Column(db.Boolean, default=False)
    enabled = db.Column(db.Boolean, default=True)
    disabled_company_ids = db.Column(db.Text, default='[]')  # per-company opt-out of a global rule
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'))
    created_at = db.Column(db.DateTime, default=utcnow)

    def user_id_list(self):
        try:
            return json.loads(self.notify_user_ids or '[]')
        except ValueError:
            return []

    def disabled_company_list(self):
        try:
            return json.loads(self.disabled_company_ids or '[]')
        except ValueError:
            return []

    def to_dict(self):
        return {
            'id': self.id,
            'company_id': self.company_id,
            'name': self.name,
            'trigger': self.trigger or 'status',
            'label_text': self.label_text,
            'action': self.action or 'notify',
            'action_param': self.action_param,
            'notify_user_ids': self.user_id_list(),
            'notify_assignees': bool(self.notify_assignees),
            'enabled': bool(self.enabled),
            'disabled_company_ids': self.disabled_company_list(),
            'created_by': self.created_by,
        }


class RecurringJob(db.Model):
    """Auto-creates a job on a board on a schedule (daily / weekly / monthly)."""
    __tablename__ = 'recurring_jobs'
    id = db.Column(db.Integer, primary_key=True)
    board_id = db.Column(db.Integer, db.ForeignKey('boards.id', ondelete='CASCADE'), nullable=False)
    name = db.Column(db.String(500), nullable=False)
    template_id = db.Column(db.Integer, db.ForeignKey('job_templates.id'))
    assignee_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    frequency = db.Column(db.String(10), nullable=False)  # daily | weekly | monthly
    weekday = db.Column(db.Integer, default=0)            # 0=Monday (weekly)
    monthday = db.Column(db.Integer, default=1)           # 1-28 (monthly)
    next_run_at = db.Column(db.DateTime, nullable=False)
    last_run_at = db.Column(db.DateTime)
    enabled = db.Column(db.Boolean, default=True)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'))
    created_at = db.Column(db.DateTime, default=utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'board_id': self.board_id,
            'name': self.name,
            'template_id': self.template_id,
            'assignee_id': self.assignee_id,
            'frequency': self.frequency,
            'weekday': self.weekday,
            'monthday': self.monthday,
            'next_run_at': iso(self.next_run_at),
            'last_run_at': iso(self.last_run_at),
            'enabled': bool(self.enabled),
            'created_by': self.created_by,
        }


class AuthToken(db.Model):
    """Single-use, expiring tokens for email flows: password resets and
    invitations. Only a hash of the token is stored."""
    __tablename__ = 'auth_tokens'
    id = db.Column(db.Integer, primary_key=True)
    kind = db.Column(db.String(20), nullable=False)  # reset | invite
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    token_hash = db.Column(db.String(64), nullable=False, index=True)
    expires_at = db.Column(db.DateTime, nullable=False)
    used = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=utcnow)


class AppSetting(db.Model):
    """Free-form key/value store for instance-wide settings (login branding, …)."""
    __tablename__ = 'app_settings'
    key = db.Column(db.String(60), primary_key=True)
    value = db.Column(db.Text, default='{}')

    @staticmethod
    def get_json(key, default=None):
        row = db.session.get(AppSetting, key)
        if not row:
            return default
        try:
            return json.loads(row.value or '{}')
        except ValueError:
            return default

    @staticmethod
    def set_json(key, value):
        row = db.session.get(AppSetting, key)
        if row is None:
            row = AppSetting(key=key)
            db.session.add(row)
        row.value = json.dumps(value)


# Actions that form the permanent audit trail — they must survive the deletion
# of the objects they describe.
AUDIT_ACTION_LIST = ('board_deleted', 'item_deleted', 'group_deleted', 'column_deleted',
                     'company_deleted', 'department_deleted', 'role_deleted',
                     'user_created', 'user_deactivated', 'user_activated', 'user_role_changed',
                     'user_deleted', 'access_granted', 'access_changed', 'access_revoked')


def iso(dt):
    if not dt:
        return None
    return dt.replace(microsecond=0).isoformat() + 'Z'
