import json

from flask import Blueprint, jsonify, request

from .. import ha
from ..auth import login_required
from ..db import db
from ..models import Activity, Board, BoardColumn, BoardGroup, Item, User
from ..services import (COLUMN_DEFAULT_WIDTH, DEFAULT_COLUMN_SETTINGS,
                        GROUP_COLORS, broadcast_board,
                        create_default_board_layout, log_activity,
                        serialize_board_full)

bp = Blueprint('boards', __name__, url_prefix='/api')


@bp.get('/boards')
@login_required
def list_boards(user):
    boards = Board.query.order_by(Board.position, Board.id).all()
    item_counts = dict(
        db.session.query(Item.board_id, db.func.count(Item.id)).group_by(Item.board_id).all())
    out = []
    for b in boards:
        d = b.to_dict()
        d['items_count'] = item_counts.get(b.id, 0)
        out.append(d)
    return jsonify({'boards': out})


@bp.post('/boards')
@login_required
def create_board(user):
    data = request.json or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Board name is required'}), 400
    max_pos = db.session.query(db.func.max(Board.position)).scalar() or 0
    board = Board(
        name=name,
        description=(data.get('description') or '').strip(),
        icon=data.get('icon') or '📋',
        color=data.get('color') or '#579bfc',
        owner_id=user.id,
        position=max_pos + 1,
    )
    db.session.add(board)
    db.session.flush()
    create_default_board_layout(board)
    log_activity(user.id, board.id, None, 'board_created', f'created board "{board.name}"')
    db.session.commit()
    ha.fire_event('taskmaster_board_created', {'board_id': board.id, 'name': board.name})
    return jsonify(serialize_board_full(board)), 201


@bp.get('/boards/<int:board_id>')
@login_required
def get_board(user, board_id):
    board = Board.query.get_or_404(board_id)
    return jsonify(serialize_board_full(board))


@bp.put('/boards/<int:board_id>')
@login_required
def update_board(user, board_id):
    board = Board.query.get_or_404(board_id)
    data = request.json or {}
    for field in ('name', 'description', 'icon', 'color'):
        if field in data:
            setattr(board, field, data[field])
    if 'archived' in data:
        board.archived = bool(data['archived'])
        log_activity(user.id, board.id, None, 'board_archived',
                     f'{"archived" if board.archived else "unarchived"} board "{board.name}"')
    if 'position' in data:
        board.position = float(data['position'])
    db.session.commit()
    broadcast_board(board.id)
    return jsonify({'board': board.to_dict()})


@bp.delete('/boards/<int:board_id>')
@login_required
def delete_board(user, board_id):
    board = Board.query.get_or_404(board_id)
    if user.role != 'admin' and board.owner_id != user.id:
        return jsonify({'error': 'Only the board owner or an admin can delete a board'}), 403
    name = board.name
    db.session.delete(board)
    db.session.commit()
    broadcast_board(board_id, kind='board_deleted')
    ha.fire_event('taskmaster_board_deleted', {'board_id': board_id, 'name': name})
    return jsonify({'ok': True})


# ---- Groups ----

@bp.post('/boards/<int:board_id>/groups')
@login_required
def create_group(user, board_id):
    board = Board.query.get_or_404(board_id)
    data = request.json or {}
    name = (data.get('name') or '').strip() or 'New Group'
    existing = BoardGroup.query.filter_by(board_id=board.id).count()
    max_pos = (db.session.query(db.func.max(BoardGroup.position))
               .filter_by(board_id=board.id).scalar() or 0)
    group = BoardGroup(
        board_id=board.id, name=name,
        color=data.get('color') or GROUP_COLORS[existing % len(GROUP_COLORS)],
        position=max_pos + 1,
    )
    db.session.add(group)
    log_activity(user.id, board.id, None, 'group_created', f'created group "{name}"')
    db.session.commit()
    broadcast_board(board.id)
    return jsonify({'group': group.to_dict()}), 201


@bp.put('/groups/<int:group_id>')
@login_required
def update_group(user, group_id):
    group = BoardGroup.query.get_or_404(group_id)
    data = request.json or {}
    for field in ('name', 'color'):
        if field in data:
            setattr(group, field, data[field])
    if 'collapsed' in data:
        group.collapsed = bool(data['collapsed'])
    if 'position' in data:
        group.position = float(data['position'])
    db.session.commit()
    broadcast_board(group.board_id)
    return jsonify({'group': group.to_dict()})


@bp.delete('/groups/<int:group_id>')
@login_required
def delete_group(user, group_id):
    group = BoardGroup.query.get_or_404(group_id)
    board_id = group.board_id
    if BoardGroup.query.filter_by(board_id=board_id).count() <= 1:
        return jsonify({'error': 'A board must keep at least one group'}), 400
    Item.query.filter_by(group_id=group.id).delete()
    log_activity(user.id, board_id, None, 'group_deleted', f'deleted group "{group.name}"')
    db.session.delete(group)
    db.session.commit()
    broadcast_board(board_id)
    return jsonify({'ok': True})


# ---- Columns ----

@bp.post('/boards/<int:board_id>/columns')
@login_required
def create_column(user, board_id):
    board = Board.query.get_or_404(board_id)
    data = request.json or {}
    ctype = data.get('type')
    if ctype not in DEFAULT_COLUMN_SETTINGS:
        return jsonify({'error': f'Unknown column type: {ctype}'}), 400
    title = (data.get('title') or '').strip() or ctype.capitalize()
    max_pos = (db.session.query(db.func.max(BoardColumn.position))
               .filter_by(board_id=board.id).scalar() or 0)
    col = BoardColumn(
        board_id=board.id, title=title, type=ctype,
        settings=json.dumps(data.get('settings') or DEFAULT_COLUMN_SETTINGS[ctype]),
        position=max_pos + 1, width=COLUMN_DEFAULT_WIDTH.get(ctype, 140),
    )
    db.session.add(col)
    log_activity(user.id, board.id, None, 'column_created', f'added column "{title}"')
    db.session.commit()
    broadcast_board(board.id)
    return jsonify({'column': col.to_dict()}), 201


@bp.put('/columns/<int:column_id>')
@login_required
def update_column(user, column_id):
    col = BoardColumn.query.get_or_404(column_id)
    data = request.json or {}
    if 'title' in data and data['title'].strip():
        col.title = data['title'].strip()
    if 'settings' in data:
        col.settings = json.dumps(data['settings'])
    if 'width' in data:
        col.width = max(70, min(500, int(data['width'])))
    if 'position' in data:
        col.position = float(data['position'])
    db.session.commit()
    broadcast_board(col.board_id)
    return jsonify({'column': col.to_dict()})


@bp.delete('/columns/<int:column_id>')
@login_required
def delete_column(user, column_id):
    col = BoardColumn.query.get_or_404(column_id)
    board_id = col.board_id
    log_activity(user.id, board_id, None, 'column_deleted', f'deleted column "{col.title}"')
    db.session.delete(col)
    db.session.commit()
    broadcast_board(board_id)
    return jsonify({'ok': True})


# ---- Activity ----

@bp.get('/boards/<int:board_id>/activity')
@login_required
def board_activity(user, board_id):
    Board.query.get_or_404(board_id)
    rows = (Activity.query.filter_by(board_id=board_id)
            .order_by(Activity.created_at.desc()).limit(100).all())
    users = {u.id: u.to_dict() for u in User.query.all()}
    return jsonify({'activity': [a.to_dict() for a in rows], 'users': users})
