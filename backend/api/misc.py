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
    board_rows = Board.query.filter(Board.id.in_({i.board_id for i in items})).all()
    dept_ids = {b.department_id for b in board_rows if b.department_id}
    depts = ({d.id: d for d in Department.query.filter(Department.id.in_(dept_ids)).all()}
             if dept_ids else {})
    comp_ids = ({b.company_id for b in board_rows if b.company_id}
                | {d.company_id for d in depts.values()})
    comps = ({c.id: c for c in Company.query.filter(Company.id.in_(comp_ids)).all()}
             if comp_ids else {})
    boards = {}
    for b in board_rows:
        d = b.to_dict()
        cid = b.company_id or (depts[b.department_id].company_id
                               if b.department_id in depts else None)
        d['company_id'] = cid
        d['company_name'] = comps[cid].name if cid in comps else None
        boards[b.id] = d
    groups = {g.id: g.to_dict() for g in
              BoardGroup.query.filter(BoardGroup.id.in_({i.group_id for i in items})).all()}
    all_values = values_for_items([i.id for i in items])
    columns = {}
    for b_id in boards:
        cols = (BoardColumn.query.filter_by(board_id=b_id)
                .order_by(BoardColumn.position).all())
        columns[str(b_id)] = [c.to_dict() for c in cols]
    parent_ids = {i.parent_id for i in items if i.parent_id}
    parent_names = ({p.id: p.name for p in Item.query.filter(Item.id.in_(parent_ids)).all()}
                    if parent_ids else {})
    out_items = []
    for i in items:
        d = i.to_dict(values=all_values.get(i.id, {}))
        d['parent_name'] = parent_names.get(i.parent_id)
        out_items.append(d)
    return jsonify({
        'items': out_items,
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


@bp.get('/overview-items')
@login_required
def overview_items(user):
    """All accessible jobs (kind=jobs) or sub-tasks (kind=tasks) across boards,
    with enough context to render a directory list."""
    kind = request.args.get('kind', 'jobs')
    boards = {}
    for b in Board.query.filter_by(archived=False).all():
        access = perm.board_access(user, b)
        if access:
            boards[b.id] = (b, access)
    if not boards:
        return jsonify({'items': []})

    q = Item.query.filter(Item.board_id.in_(list(boards)))
    q = q.filter(Item.parent_id.is_(None)) if kind == 'jobs' else q.filter(Item.parent_id.isnot(None))
    items = q.order_by(Item.updated_at.desc()).all()

    # filter partial boards down to visible items
    visible_cache = {}
    out_items = []
    for i in items:
        b, access = boards[i.board_id]
        if access == 'partial':
            if i.board_id not in visible_cache:
                visible_cache[i.board_id] = perm.visible_item_ids(user, b)
            if i.id not in visible_cache[i.board_id]:
                continue
        out_items.append(i)

    # context: company names, status label per item, parent names
    from ..models import Company as _Company, Department as _Department
    company_names = {c.id: c.name for c in _Company.query.all()}
    board_company = {bid: perm.board_company_id(b) for bid, (b, _a) in boards.items()}
    status_cols = {}
    for bid, (b, _a) in boards.items():
        col = (BoardColumn.query.filter_by(board_id=bid, type='status')
               .order_by(BoardColumn.position).first())
        if col:
            status_cols[bid] = (col.id, {l['id']: l for l in col.settings_dict().get('labels', [])})
    ids = [i.id for i in out_items]
    status_values = {}
    if ids:
        col_ids = [c[0] for c in status_cols.values()]
        for v in ItemValue.query.filter(ItemValue.item_id.in_(ids),
                                        ItemValue.column_id.in_(col_ids)).all():
            status_values[v.item_id] = v.value_dict().get('id')
    parent_names = {}
    parent_ids = {i.parent_id for i in out_items if i.parent_id}
    if parent_ids:
        parent_names = {p.id: p.name for p in Item.query.filter(Item.id.in_(parent_ids)).all()}

    result = []
    for i in out_items:
        b, _access = boards[i.board_id]
        label = None
        if i.board_id in status_cols:
            _cid, labels = status_cols[i.board_id]
            label = labels.get(status_values.get(i.id))
        result.append({
            'id': i.id, 'name': i.name, 'board_id': i.board_id,
            'board_name': b.name, 'board_icon': b.icon,
            'company_name': company_names.get(board_company.get(i.board_id), ''),
            'status': {'label': label['label'], 'color': label['color']} if label else None,
            'parent_name': parent_names.get(i.parent_id),
            'updated_at': i.updated_at.isoformat() + 'Z' if i.updated_at else None,
        })
    return jsonify({'items': result})


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
