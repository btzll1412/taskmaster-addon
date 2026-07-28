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
    role = db.Column(db.String(20), default='member')  # admin | member
    auth_source = db.Column(db.String(20), default='local')  # local (ldap planned)
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=utcnow)

    def to_dict(self, include_private=False):
        d = {
            'id': self.id,
            'username': self.username,
            'display_name': self.display_name,
            'color': self.color,
            'role': self.role,
            'is_active': self.is_active,
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
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'))
    action = db.Column(db.String(50), nullable=False)
    description = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow)

    __table_args__ = (
        db.Index('idx_activity_board', 'board_id'),
        db.Index('idx_activity_item', 'item_id'),
        db.Index('idx_activity_created', 'created_at'),
    )

    def to_dict(self):
        return {
            'id': self.id,
            'board_id': self.board_id,
            'item_id': self.item_id,
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


def iso(dt):
    if not dt:
        return None
    return dt.replace(microsecond=0).isoformat() + 'Z'
