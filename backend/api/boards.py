import json

from flask import Blueprint, jsonify, request

from .. import ha
from .. import permissions as perm
from ..auth import login_required
from ..db import db
from ..models import (Activity, Board, BoardColumn, BoardGroup, Department,
                      Item, User)
from ..services import (COLUMN_DEFAULT_WIDTH, DEFAULT_COLUMN_SETTINGS,
                        GROUP_COLORS, broadcast_board,
                        create_default_board_layout, log_activity,
                        serialize_board_full)

bp = Blueprint('boards', __name__, url_prefix='/api')


def _board_or_403(user, board_id, need_edit=False):
    board = Board.query.get_or_404(board_id)
    access = perm.board_access(user, board)
    if access is None or (need_edit and not perm.can_edit_board(user, board)):
        return board, None
    return board, access


@bp.get('/boards')
@login_required
def list_boards(user):
    """Flat list of accessible boards (the sidebar uses /api/workspace)."""
    out = []
    for b in Board.query.order_by(Board.position, Board.id).all():
        access = perm.board_access(user, b)
        if access:
            d = b.to_dict()
            d['access'] = access
            out.append(d)
    return jsonify({'boards': out})


def _can_create_in_company(user, company_id, dept_id=None):
    return perm.can_create_board_in(user, company_id, dept_id)


def _create_board(user, data, dept=None, company_id=None):
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Board name is required'}), 400
    max_pos = db.session.query(db.func.max(Board.position)).scalar() or 0
    board = Board(
        name=name,
        description=(data.get('description') or '').strip(),
        icon=data.get('icon') or '📋',
        color=data.get('color') or '#579bfc',
        department_id=dept.id if dept else None,
        company_id=None if dept else company_id,
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


@bp.post('/departments/<int:dept_id>/boards')
@login_required
def create_board(user, dept_id):
    dept = Department.query.get_or_404(dept_id)
    if not _can_create_in_company(user, dept.company_id, dept.id):
        return jsonify({'error': 'No permission to create boards in this department'}), 403
    return _create_board(user, request.json or {}, dept=dept)


@bp.post('/companies/<int:company_id>/boards')
@login_required
def create_company_board(user, company_id):
    """Board that lives directly under a company, outside any department."""
    from ..models import Company
    Company.query.get_or_404(company_id)
    if not _can_create_in_company(user, company_id):
        return jsonify({'error': 'No permission to create boards in this company'}), 403
    return _create_board(user, request.json or {}, company_id=company_id)


@bp.get('/boards/<int:board_id>')
@login_required
def get_board(user, board_id):
    board, access = _board_or_403(user, board_id)
    if not access:
        return jsonify({'error': 'You do not have access to this board'}), 403
    visible = perm.visible_item_ids(user, board)
    payload = serialize_board_full(board, visible_ids=visible, access=access)
    dept = db.session.get(Department, board.department_id) if board.department_id else None
    payload['department'] = dept.to_dict() if dept else None
    return jsonify(payload)


@bp.put('/boards/<int:board_id>')
@login_required
def update_board(user, board_id):
    board, access = _board_or_403(user, board_id, need_edit=True)
    if not access:
        return jsonify({'error': 'No permission to edit this board'}), 403
    data = request.json or {}
    for field in ('name', 'description', 'icon', 'color'):
        if field in data:
            setattr(board, field, data[field])
    if 'department_id' in data and perm.is_super(user):
        if Department.query.get(data['department_id']):
            board.department_id = data['department_id']
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
    company_id = perm.board_company_id(board)
    if not (perm.is_super(user) or board.owner_id == user.id
            or (company_id and perm.can_manage_company(user, company_id))):
        return jsonify({'error': 'Only the board owner or an admin can delete a board'}), 403
    name = board.name
    dept = db.session.get(Department, board.department_id) if board.department_id else None
    where = f' ({dept.name})' if dept else ''
    from ..services import purge_board
    purge_board(board)
    log_activity(user.id, None, None, 'board_deleted',
                 f'deleted board "{name}"{where}', company_id=company_id)
    db.session.commit()
    broadcast_board(board_id, kind='board_deleted')
    ha.fire_event('taskmaster_board_deleted', {'board_id': board_id, 'name': name})
    return jsonify({'ok': True})


@bp.get('/boards/<int:board_id>/items')
@login_required
def list_items_lite(user, board_id):
    """Light job list (id + name + status color) for the sidebar tree."""
    board, access = _board_or_403(user, board_id)
    if not access:
        return jsonify({'error': 'You do not have access to this board'}), 403
    visible = perm.visible_item_ids(user, board)
    items = (Item.query.filter_by(board_id=board.id)
             .filter(Item.parent_id.is_(None)).order_by(Item.position).all())
    if visible is not None:
        items = [i for i in items if i.id in visible]
    # first status column gives each job its dot color
    from ..models import ItemValue
    status_col = (BoardColumn.query.filter_by(board_id=board.id, type='status')
                  .order_by(BoardColumn.position).first())
    colors = {}
    if status_col and items:
        labels = {l['id']: l['color'] for l in status_col.settings_dict().get('labels', [])}
        for v in ItemValue.query.filter(
                ItemValue.column_id == status_col.id,
                ItemValue.item_id.in_([i.id for i in items])).all():
            colors[v.item_id] = labels.get(v.value_dict().get('id'))
    return jsonify({'items': [
        {'id': i.id, 'name': i.name, 'color': colors.get(i.id)} for i in items
    ]})


# ---- Groups ----

@bp.post('/boards/<int:board_id>/groups')
@login_required
def create_group(user, board_id):
    board, access = _board_or_403(user, board_id, need_edit=True)
    if not access:
        return jsonify({'error': 'No permission to edit this board'}), 403
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
    board = db.session.get(Board, group.board_id)
    if not perm.can_edit_board(user, board):
        return jsonify({'error': 'No permission to edit this board'}), 403
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
    board = db.session.get(Board, group.board_id)
    if not perm.can_edit_board(user, board):
        return jsonify({'error': 'No permission to edit this board'}), 403
    board_id = group.board_id
    if BoardGroup.query.filter_by(board_id=board_id).count() <= 1:
        return jsonify({'error': 'A board must keep at least one group'}), 400
    from ..services import purge_items
    purge_items(Item.query.filter_by(group_id=group.id).all())
    log_activity(user.id, board_id, None, 'group_deleted', f'deleted group "{group.name}"')
    db.session.delete(group)
    db.session.commit()
    broadcast_board(board_id)
    return jsonify({'ok': True})


# ---- Columns ----

@bp.post('/boards/<int:board_id>/columns')
@login_required
def create_column(user, board_id):
    board, access = _board_or_403(user, board_id, need_edit=True)
    if not access:
        return jsonify({'error': 'No permission to edit this board'}), 403
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
    board = db.session.get(Board, col.board_id)
    if not perm.can_edit_board(user, board):
        return jsonify({'error': 'No permission to edit this board'}), 403
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
    board = db.session.get(Board, col.board_id)
    if not perm.can_edit_board(user, board):
        return jsonify({'error': 'No permission to edit this board'}), 403
    board_id = col.board_id
    from ..models import ItemValue, NotificationRule
    ItemValue.query.filter_by(column_id=col.id).delete(synchronize_session=False)
    NotificationRule.query.filter_by(column_id=col.id).delete(synchronize_session=False)
    log_activity(user.id, board_id, None, 'column_deleted', f'deleted column "{col.title}"')
    db.session.delete(col)
    db.session.commit()
    broadcast_board(board_id)
    return jsonify({'ok': True})


# ---- Activity ----

@bp.get('/boards/<int:board_id>/activity')
@login_required
def board_activity(user, board_id):
    board, access = _board_or_403(user, board_id)
    if not access:
        return jsonify({'error': 'You do not have access to this board'}), 403
    rows = (Activity.query.filter_by(board_id=board_id)
            .order_by(Activity.created_at.desc()).limit(100).all())
    users = {u.id: u.to_dict() for u in User.query.all()}
    return jsonify({'activity': [a.to_dict() for a in rows], 'users': users})
