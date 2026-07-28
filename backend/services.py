"""Shared helpers: activity logging, notifications, board serialization, defaults."""
import json

from . import realtime
from .db import db
from .models import (Activity, Board, BoardColumn, BoardGroup, FileAsset, Item,
                     ItemUpdate, ItemValue, Notification)

STATUS_PRESET = [
    {'id': 'l1', 'label': 'Not Started', 'color': '#c4c4c4'},
    {'id': 'l2', 'label': 'Working on it', 'color': '#fdab3d'},
    {'id': 'l3', 'label': 'Stuck', 'color': '#e2445c'},
    {'id': 'l4', 'label': 'Done', 'color': '#00c875'},
]

PRIORITY_PRESET = [
    {'id': 'p1', 'label': 'Critical', 'color': '#333333'},
    {'id': 'p2', 'label': 'High', 'color': '#401694'},
    {'id': 'p3', 'label': 'Medium', 'color': '#5559df'},
    {'id': 'p4', 'label': 'Low', 'color': '#579bfc'},
]

GROUP_COLORS = ['#579bfc', '#00c875', '#a25ddc', '#fdab3d', '#e2445c', '#66ccff', '#ff642e']

DEFAULT_COLUMN_SETTINGS = {
    'status': {'labels': STATUS_PRESET},
    'priority': {'labels': PRIORITY_PRESET},
    'dropdown': {'options': []},
    'text': {},
    'people': {},
    'date': {},
    'number': {'unit': ''},
    'checkbox': {},
}

COLUMN_DEFAULT_WIDTH = {
    'status': 150, 'priority': 140, 'text': 180, 'people': 130,
    'date': 140, 'number': 110, 'dropdown': 160, 'checkbox': 90,
}


def log_activity(user_id, board_id, item_id, action, description):
    db.session.add(Activity(
        user_id=user_id, board_id=board_id, item_id=item_id,
        action=action, description=description,
    ))


def notify_user(user_id, actor_id, ntype, board_id, item_id, message):
    """Create an in-app notification (skipping self-notifications) and push it live."""
    if user_id == actor_id or user_id is None:
        return
    n = Notification(
        user_id=user_id, actor_id=actor_id, type=ntype,
        board_id=board_id, item_id=item_id, message=message,
    )
    db.session.add(n)
    db.session.flush()
    realtime.publish({'type': 'notification'}, target_user_id=user_id)


def broadcast_board(board_id, kind='board_changed'):
    realtime.publish({'type': kind, 'board_id': board_id})


def item_counts(item_ids):
    """Return {item_id: {'updates': n, 'files': n}} for a set of items."""
    counts = {i: {'updates': 0, 'files': 0} for i in item_ids}
    if not item_ids:
        return counts
    rows = (db.session.query(ItemUpdate.item_id, db.func.count(ItemUpdate.id))
            .filter(ItemUpdate.item_id.in_(item_ids)).group_by(ItemUpdate.item_id).all())
    for iid, n in rows:
        counts[iid]['updates'] = n
    rows = (db.session.query(FileAsset.item_id, db.func.count(FileAsset.id))
            .filter(FileAsset.item_id.in_(item_ids)).group_by(FileAsset.item_id).all())
    for iid, n in rows:
        counts[iid]['files'] = n
    return counts


def values_for_items(item_ids):
    """Return {item_id: {column_id: value_dict}}."""
    out = {i: {} for i in item_ids}
    if not item_ids:
        return out
    for v in ItemValue.query.filter(ItemValue.item_id.in_(item_ids)).all():
        out[v.item_id][str(v.column_id)] = v.value_dict()
    return out


def serialize_board_full(board):
    groups = (BoardGroup.query.filter_by(board_id=board.id)
              .order_by(BoardGroup.position).all())
    columns = (BoardColumn.query.filter_by(board_id=board.id)
               .order_by(BoardColumn.position).all())
    items = (Item.query.filter_by(board_id=board.id)
             .order_by(Item.position).all())
    ids = [i.id for i in items]
    values = values_for_items(ids)
    counts = item_counts(ids)
    return {
        'board': board.to_dict(),
        'groups': [g.to_dict() for g in groups],
        'columns': [c.to_dict() for c in columns],
        'items': [i.to_dict(values=values.get(i.id, {}), counts=counts.get(i.id)) for i in items],
    }


def create_default_board_layout(board):
    """Give a fresh board monday-style defaults: two groups + core columns."""
    db.session.add(BoardGroup(board_id=board.id, name='To-Do', color='#579bfc', position=1))
    db.session.add(BoardGroup(board_id=board.id, name='Completed', color='#00c875', position=2))
    defaults = [
        ('Status', 'status'), ('People', 'people'), ('Due date', 'date'), ('Priority', 'priority'),
    ]
    for pos, (title, ctype) in enumerate(defaults, start=1):
        db.session.add(BoardColumn(
            board_id=board.id, title=title, type=ctype,
            settings=json.dumps(DEFAULT_COLUMN_SETTINGS[ctype]),
            position=pos, width=COLUMN_DEFAULT_WIDTH[ctype],
        ))


def people_column_user_ids(item_id):
    """All user ids present in any people-column value of an item."""
    ids = set()
    for v in ItemValue.query.filter_by(item_id=item_id).all():
        col = BoardColumn.query.get(v.column_id)
        if col and col.type == 'people':
            ids.update(v.value_dict().get('user_ids') or [])
    return ids
