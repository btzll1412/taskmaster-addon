import json
import os
import uuid
from datetime import datetime

from flask import Blueprint, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename

from .. import ha
from ..auth import login_required
from ..config import ALLOWED_EXTENSIONS, UPLOAD_DIR
from ..db import db
from ..models import (Activity, Board, BoardColumn, BoardGroup, FileAsset,
                      Item, ItemUpdate, ItemValue, User)
from ..services import (broadcast_board, log_activity, notify_user,
                        people_column_user_ids)

bp = Blueprint('items', __name__, url_prefix='/api')


@bp.post('/boards/<int:board_id>/items')
@login_required
def create_item(user, board_id):
    board = Board.query.get_or_404(board_id)
    data = request.json or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Item name is required'}), 400
    group = None
    if data.get('group_id'):
        group = BoardGroup.query.filter_by(id=data['group_id'], board_id=board.id).first()
    if group is None:
        group = (BoardGroup.query.filter_by(board_id=board.id)
                 .order_by(BoardGroup.position).first())
    if group is None:
        return jsonify({'error': 'Board has no groups'}), 400
    max_pos = (db.session.query(db.func.max(Item.position))
               .filter_by(group_id=group.id).scalar() or 0)
    item = Item(board_id=board.id, group_id=group.id, name=name,
                position=max_pos + 1, created_by=user.id)
    db.session.add(item)
    db.session.flush()
    log_activity(user.id, board.id, item.id, 'item_created', f'created "{name}"')
    db.session.commit()
    broadcast_board(board.id)
    ha.fire_event('taskmaster_item_created', {
        'item_id': item.id, 'board_id': board.id,
        'board': board.name, 'name': name, 'created_by': user.username,
    })
    return jsonify({'item': item.to_dict(values={}, counts={})}), 201


@bp.put('/items/<int:item_id>')
@login_required
def update_item(user, item_id):
    item = Item.query.get_or_404(item_id)
    data = request.json or {}
    if 'name' in data and data['name'].strip():
        old = item.name
        item.name = data['name'].strip()
        if old != item.name:
            log_activity(user.id, item.board_id, item.id, 'item_renamed',
                         f'renamed "{old}" to "{item.name}"')
    if 'group_id' in data:
        group = BoardGroup.query.filter_by(id=data['group_id'], board_id=item.board_id).first()
        if group and group.id != item.group_id:
            item.group_id = group.id
            log_activity(user.id, item.board_id, item.id, 'item_moved',
                         f'moved "{item.name}" to group "{group.name}"')
    if 'position' in data:
        item.position = float(data['position'])
    db.session.commit()
    broadcast_board(item.board_id)
    return jsonify({'item': item.to_dict()})


@bp.delete('/items/<int:item_id>')
@login_required
def delete_item(user, item_id):
    item = Item.query.get_or_404(item_id)
    board_id = item.board_id
    log_activity(user.id, board_id, None, 'item_deleted', f'deleted "{item.name}"')
    ItemValue.query.filter_by(item_id=item.id).delete()
    ItemUpdate.query.filter_by(item_id=item.id).delete()
    for f in FileAsset.query.filter_by(item_id=item.id).all():
        try:
            os.remove(os.path.join(UPLOAD_DIR, f.filename))
        except OSError:
            pass
        db.session.delete(f)
    db.session.delete(item)
    db.session.commit()
    broadcast_board(board_id)
    return jsonify({'ok': True})


def _describe_value(col, value):
    """Human-readable rendering of a column value for the activity log."""
    if value is None:
        return 'empty'
    settings = col.settings_dict()
    if col.type in ('status', 'priority'):
        labels = {l['id']: l['label'] for l in settings.get('labels', [])}
        return labels.get(value.get('id'), 'empty')
    if col.type == 'people':
        ids = value.get('user_ids') or []
        if not ids:
            return 'nobody'
        users = User.query.filter(User.id.in_(ids)).all()
        return ', '.join(u.display_name for u in users)
    if col.type == 'date':
        return value.get('date') or 'empty'
    if col.type == 'text':
        return value.get('text') or 'empty'
    if col.type == 'number':
        n = value.get('number')
        return str(n) if n is not None else 'empty'
    if col.type == 'dropdown':
        opts = {o['id']: o['label'] for o in settings.get('options', [])}
        ids = value.get('ids') or []
        return ', '.join(opts.get(i, '?') for i in ids) or 'empty'
    if col.type == 'checkbox':
        return 'checked' if value.get('checked') else 'unchecked'
    return 'updated'


@bp.put('/items/<int:item_id>/values/<int:column_id>')
@login_required
def set_value(user, item_id, column_id):
    item = Item.query.get_or_404(item_id)
    col = BoardColumn.query.get_or_404(column_id)
    if col.board_id != item.board_id:
        return jsonify({'error': 'Column does not belong to this board'}), 400
    value = (request.json or {}).get('value')

    iv = ItemValue.query.filter_by(item_id=item.id, column_id=col.id).first()
    old_value = iv.value_dict() if iv else None
    if value is None:
        if iv:
            db.session.delete(iv)
    elif iv:
        iv.value = json.dumps(value)
    else:
        iv = ItemValue(item_id=item.id, column_id=col.id, value=json.dumps(value))
        db.session.add(iv)

    old_desc = _describe_value(col, old_value)
    new_desc = _describe_value(col, value)
    if old_desc != new_desc:
        log_activity(user.id, item.board_id, item.id, 'value_changed',
                     f'changed {col.title} on "{item.name}" from {old_desc} to {new_desc}')

    # Notify newly assigned people
    if col.type == 'people':
        old_ids = set((old_value or {}).get('user_ids') or [])
        new_ids = set((value or {}).get('user_ids') or [])
        board = Board.query.get(item.board_id)
        for uid in new_ids - old_ids:
            notify_user(uid, user.id, 'assigned', item.board_id, item.id,
                        f'{user.display_name} assigned you to "{item.name}" on {board.name}')

    item.updated_at = datetime.utcnow()
    db.session.commit()
    broadcast_board(item.board_id)

    if col.type in ('status', 'priority') and old_desc != new_desc:
        board = Board.query.get(item.board_id)
        ha.fire_event('taskmaster_status_changed', {
            'item_id': item.id, 'board_id': board.id, 'board': board.name,
            'name': item.name, 'column': col.title,
            'old_status': old_desc, 'new_status': new_desc, 'changed_by': user.username,
        })
        # Notify assignees about status changes made by someone else
        for uid in people_column_user_ids(item.id):
            notify_user(uid, user.id, 'status', item.board_id, item.id,
                        f'{user.display_name} set {col.title} of "{item.name}" to {new_desc}')
        db.session.commit()

    return jsonify({'ok': True, 'value': value})


@bp.get('/items/<int:item_id>')
@login_required
def get_item(user, item_id):
    item = Item.query.get_or_404(item_id)
    values = {str(v.column_id): v.value_dict()
              for v in ItemValue.query.filter_by(item_id=item.id).all()}
    updates = (ItemUpdate.query.filter_by(item_id=item.id)
               .order_by(ItemUpdate.created_at.desc()).all())
    files = (FileAsset.query.filter_by(item_id=item.id)
             .order_by(FileAsset.created_at.desc()).all())
    activity = (Activity.query.filter_by(item_id=item.id)
                .order_by(Activity.created_at.desc()).limit(50).all())
    return jsonify({
        'item': item.to_dict(values=values),
        'updates': [u.to_dict() for u in updates],
        'files': [f.to_dict() for f in files],
        'activity': [a.to_dict() for a in activity],
    })


# ---- Updates (comments) ----

@bp.post('/items/<int:item_id>/updates')
@login_required
def create_update(user, item_id):
    item = Item.query.get_or_404(item_id)
    body = ((request.json or {}).get('body') or '').strip()
    if not body:
        return jsonify({'error': 'Update text is required'}), 400
    upd = ItemUpdate(item_id=item.id, user_id=user.id, body=body)
    db.session.add(upd)
    log_activity(user.id, item.board_id, item.id, 'update_posted',
                 f'wrote an update on "{item.name}"')
    for uid in people_column_user_ids(item.id):
        notify_user(uid, user.id, 'update', item.board_id, item.id,
                    f'{user.display_name} wrote an update on "{item.name}"')
    db.session.commit()
    broadcast_board(item.board_id)
    return jsonify({'update': upd.to_dict()}), 201


@bp.put('/updates/<int:update_id>')
@login_required
def edit_update(user, update_id):
    upd = ItemUpdate.query.get_or_404(update_id)
    if upd.user_id != user.id and user.role != 'admin':
        return jsonify({'error': 'You can only edit your own updates'}), 403
    body = ((request.json or {}).get('body') or '').strip()
    if not body:
        return jsonify({'error': 'Update text is required'}), 400
    upd.body = body
    db.session.commit()
    return jsonify({'update': upd.to_dict()})


@bp.delete('/updates/<int:update_id>')
@login_required
def delete_update(user, update_id):
    upd = ItemUpdate.query.get_or_404(update_id)
    if upd.user_id != user.id and user.role != 'admin':
        return jsonify({'error': 'You can only delete your own updates'}), 403
    db.session.delete(upd)
    db.session.commit()
    return jsonify({'ok': True})


# ---- Files ----

def _allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@bp.post('/items/<int:item_id>/files')
@login_required
def upload_file(user, item_id):
    item = Item.query.get_or_404(item_id)
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    f = request.files['file']
    if not f.filename or not _allowed_file(f.filename):
        return jsonify({'error': 'File type not allowed'}), 400
    original = secure_filename(f.filename)
    stored = f'{uuid.uuid4().hex}_{original}'
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    path = os.path.join(UPLOAD_DIR, stored)
    f.save(path)
    asset = FileAsset(
        item_id=item.id, user_id=user.id, filename=stored,
        original_filename=original, mime_type=f.mimetype,
        file_size=os.path.getsize(path),
    )
    db.session.add(asset)
    log_activity(user.id, item.board_id, item.id, 'file_uploaded',
                 f'uploaded {original} to "{item.name}"')
    db.session.commit()
    broadcast_board(item.board_id)
    return jsonify({'file': asset.to_dict()}), 201


@bp.get('/files/<int:file_id>/download')
@login_required
def download_file(user, file_id):
    asset = FileAsset.query.get_or_404(file_id)
    return send_from_directory(UPLOAD_DIR, asset.filename,
                               download_name=asset.original_filename)


@bp.delete('/files/<int:file_id>')
@login_required
def delete_file(user, file_id):
    asset = FileAsset.query.get_or_404(file_id)
    if asset.user_id != user.id and user.role != 'admin':
        return jsonify({'error': 'You can only delete your own files'}), 403
    try:
        os.remove(os.path.join(UPLOAD_DIR, asset.filename))
    except OSError:
        pass
    item = Item.query.get(asset.item_id)
    db.session.delete(asset)
    db.session.commit()
    if item:
        broadcast_board(item.board_id)
    return jsonify({'ok': True})
