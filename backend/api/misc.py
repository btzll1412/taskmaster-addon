from flask import Blueprint, Response, jsonify, request, stream_with_context

from .. import ha, realtime
from .. import permissions as perm
from ..auth import login_required
from ..db import db
from ..models import (Activity, Board, BoardColumn, BoardGroup, Company,
                      Department, Item, ItemValue, Notification, User)
from ..services import values_for_items

bp = Blueprint('misc', __name__, url_prefix='/api')


@bp.get('/events')
@login_required
def events(user):
    q = realtime.subscribe(user.id)

    def generate():
        try:
            yield from realtime.sse_stream(q)
        finally:
            realtime.unsubscribe(q)

    return Response(stream_with_context(generate()), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


@bp.get('/notifications')
@login_required
def notifications(user):
    rows = (Notification.query.filter_by(user_id=user.id)
            .order_by(Notification.created_at.desc()).limit(100).all())
    unread = Notification.query.filter_by(user_id=user.id, read=False).count()
    users = {u.id: u.to_dict() for u in User.query.all()}
    return jsonify({'notifications': [n.to_dict() for n in rows],
                    'unread': unread, 'users': users})


@bp.post('/notifications/read')
@login_required
def mark_read(user):
    ids = (request.json or {}).get('ids')
    q = Notification.query.filter_by(user_id=user.id, read=False)
    if ids:
        q = q.filter(Notification.id.in_(ids))
    q.update({'read': True}, synchronize_session=False)
    db.session.commit()
    return jsonify({'ok': True})


@bp.get('/my-work')
@login_required
def my_work(user):
    """All items across boards where a people column contains the current user."""
    people_cols = BoardColumn.query.filter_by(type='people').all()
    col_ids = [c.id for c in people_cols]
    if not col_ids:
        return jsonify({'items': [], 'boards': {}, 'columns': []})
    needle = f'"user_ids"'
    values = (ItemValue.query.filter(ItemValue.column_id.in_(col_ids),
                                     ItemValue.value.contains(needle)).all())
    item_ids = {v.item_id for v in values
                if user.id in (v.value_dict().get('user_ids') or [])}
    items = Item.query.filter(Item.id.in_(item_ids)).all() if item_ids else []
    boards = {b.id: b.to_dict() for b in
              Board.query.filter(Board.id.in_({i.board_id for i in items})).all()}
    groups = {g.id: g.to_dict() for g in
              BoardGroup.query.filter(BoardGroup.id.in_({i.group_id for i in items})).all()}
    all_values = values_for_items([i.id for i in items])
    columns = {}
    for b_id in boards:
        cols = (BoardColumn.query.filter_by(board_id=b_id)
                .order_by(BoardColumn.position).all())
        columns[str(b_id)] = [c.to_dict() for c in cols]
    return jsonify({
        'items': [i.to_dict(values=all_values.get(i.id, {})) for i in items],
        'boards': boards,
        'groups': groups,
        'columns': columns,
    })


@bp.get('/search')
@login_required
def search(user):
    q = (request.args.get('q') or '').strip()
    if len(q) < 2:
        return jsonify({'items': [], 'boards': []})
    like = f'%{q}%'
    items = [i for i in (Item.query.filter(Item.name.ilike(like))
                         .order_by(Item.updated_at.desc()).limit(120).all())
             if perm.can_view_item(user, i)][:30]
    boards = [b for b in Board.query.filter(Board.name.ilike(like)).limit(40).all()
              if perm.board_access(user, b)][:10]
    board_names = {b.id: b.name for b in
                   Board.query.filter(Board.id.in_({i.board_id for i in items})).all()}
    out = []
    for i in items:
        d = i.to_dict()
        d['board_name'] = board_names.get(i.board_id, '')
        out.append(d)
    return jsonify({'items': out, 'boards': [b.to_dict() for b in boards]})


@bp.get('/stats')
@login_required
def stats(user):
    my_boards = [b for b in Board.query.all() if perm.board_access(user, b) == 'full']
    board_ids = [b.id for b in my_boards]
    boards_count = len([b for b in my_boards if not b.archived])
    items_count = (Item.query.filter(Item.board_id.in_(board_ids)).count()
                   if board_ids else 0)
    users_count = len([u for u in perm.visible_users(user) if u.is_active])

    # Done = item whose status column value carries a "Done" label
    done = 0
    status_cols = (BoardColumn.query.filter(BoardColumn.type == 'status',
                                            BoardColumn.board_id.in_(board_ids)).all()
                   if board_ids else [])
    done_ids = {}
    for c in status_cols:
        done_ids[c.id] = {l['id'] for l in c.settings_dict().get('labels', [])
                          if l.get('label', '').lower() == 'done'}
    if done_ids:
        for v in ItemValue.query.filter(ItemValue.column_id.in_(list(done_ids))).all():
            if v.value_dict().get('id') in done_ids.get(v.column_id, set()):
                done += 1

    recent = ((Activity.query.filter(Activity.board_id.in_(board_ids))
               .order_by(Activity.created_at.desc()).limit(20).all())
              if board_ids else [])
    users = {u.id: u.to_dict() for u in User.query.all()}
    board_names = {b.id: b.name for b in Board.query.all()}

    ha.update_sensor('sensor.taskmaster_items', items_count, {
        'friendly_name': 'TaskMaster items', 'done': done, 'boards': boards_count,
    })

    # High-level overview counts, scoped to what this user can access
    if perm.is_super(user):
        overview = {
            'companies': Company.query.count(),
            'departments': Department.query.count(),
            'boards': Board.query.filter_by(archived=False).count(),
            'jobs': Item.query.filter(Item.parent_id.is_(None)).count(),
            'tasks': Item.query.filter(Item.parent_id.isnot(None)).count(),
            'users': User.query.filter_by(is_active=True).count(),
        }
    else:
        companies = perm.accessible_companies(user)
        dept_count = (Department.query.filter(
            Department.company_id.in_([c.id for c in companies])).count()
            if companies else 0)
        jobs = (Item.query.filter(Item.board_id.in_(board_ids),
                                  Item.parent_id.is_(None)).count()
                if board_ids else 0)
        tasks = (Item.query.filter(Item.board_id.in_(board_ids),
                                   Item.parent_id.isnot(None)).count()
                 if board_ids else 0)
        overview = {
            'companies': len(companies),
            'departments': dept_count,
            'boards': boards_count,
            'jobs': jobs,
            'tasks': tasks,
            'users': users_count,
        }

    return jsonify({
        'boards': boards_count,
        'items': items_count,
        'done': done,
        'users': users_count,
        'overview': overview,
        'is_super': perm.is_super(user),
        'recent_activity': [a.to_dict() for a in recent],
        'activity_users': users,
        'board_names': board_names,
    })
