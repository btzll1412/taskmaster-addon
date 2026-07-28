"""Access control.

Rules:
- super_admin sees and manages everything.
- company_admin has full access to every board in their own company and manages
  that company's users and grants.
- member sees only what an AccessGrant covers (company / department / board /
  single item) — plus items they are assigned to via a people column.
"""
from .db import db
from .models import (AccessGrant, Board, BoardColumn, Company, Department,
                     Item, ItemValue, User)


def is_super(user):
    return user.role == 'super_admin'


def user_grants(user):
    return AccessGrant.query.filter_by(user_id=user.id).all()


def board_company_id(board):
    if board.department_id:
        dept = db.session.get(Department, board.department_id)
        return dept.company_id if dept else board.company_id
    return board.company_id


def _granted_board_ids(user):
    """Board ids covered by full-board-or-wider grants."""
    grants = user_grants(user)
    company_ids = {g.scope_id for g in grants if g.scope_type == 'company'}
    dept_ids = {g.scope_id for g in grants if g.scope_type == 'department'}
    board_ids = {g.scope_id for g in grants if g.scope_type == 'board'}
    if user.role == 'company_admin' and user.company_id:
        company_ids.add(user.company_id)
    if company_ids:
        dept_ids |= {d.id for d in Department.query.filter(
            Department.company_id.in_(company_ids)).all()}
    if dept_ids:
        board_ids |= {b.id for b in Board.query.filter(
            Board.department_id.in_(dept_ids)).all()}
    if company_ids:
        board_ids |= {b.id for b in Board.query.filter(
            Board.company_id.in_(company_ids)).all()}
    return board_ids


def _assigned_item_ids_on_board(user, board_id):
    """Items on a board where the user appears in a people column."""
    people_cols = [c.id for c in BoardColumn.query.filter_by(
        board_id=board_id, type='people').all()]
    if not people_cols:
        return set()
    out = set()
    for v in ItemValue.query.filter(ItemValue.column_id.in_(people_cols)).all():
        if user.id in (v.value_dict().get('user_ids') or []):
            out.add(v.item_id)
    return out


def board_access(user, board):
    """Returns 'full', 'partial' (some items only), or None."""
    if is_super(user):
        return 'full'
    if board.id in _granted_board_ids(user):
        return 'full'
    item_grants = AccessGrant.query.filter_by(user_id=user.id, scope_type='item').all()
    if item_grants:
        granted_items = Item.query.filter(
            Item.id.in_([g.scope_id for g in item_grants]),
            Item.board_id == board.id).first()
        if granted_items:
            return 'partial'
    if _assigned_item_ids_on_board(user, board.id):
        return 'partial'
    return None


def visible_item_ids(user, board):
    """None means all items visible; otherwise the set of visible item ids
    (including their sub-items)."""
    access = board_access(user, board)
    if access == 'full':
        return None
    if access is None:
        return set()
    ids = set()
    item_grants = AccessGrant.query.filter_by(user_id=user.id, scope_type='item').all()
    if item_grants:
        for i in Item.query.filter(Item.id.in_([g.scope_id for g in item_grants]),
                                   Item.board_id == board.id).all():
            ids.add(i.id)
    ids |= _assigned_item_ids_on_board(user, board.id)
    # roll visibility up/down the parent-child chain
    all_items = Item.query.filter_by(board_id=board.id).all()
    by_id = {i.id: i for i in all_items}
    # a visible sub-item reveals its parent (as context)
    for iid in list(ids):
        item = by_id.get(iid)
        while item and item.parent_id and item.parent_id not in ids:
            ids.add(item.parent_id)
            item = by_id.get(item.parent_id)
    # a visible parent reveals its sub-items
    changed = True
    while changed:
        changed = False
        for i in all_items:
            if i.parent_id in ids and i.id not in ids:
                ids.add(i.id)
                changed = True
    return ids


def can_view_item(user, item):
    board = db.session.get(Board, item.board_id)
    if not board:
        return False
    vis = visible_item_ids(user, board)
    return vis is None or item.id in vis


def can_edit_board(user, board):
    return board_access(user, board) == 'full'


def can_manage_company(user, company_id):
    if is_super(user):
        return True
    return user.role == 'company_admin' and user.company_id == company_id


def can_manage_user(actor, target):
    if is_super(actor):
        return True
    return (actor.role == 'company_admin' and target.company_id == actor.company_id
            and target.role != 'super_admin')


def accessible_companies(user):
    if is_super(user):
        return Company.query.order_by(Company.position, Company.id).all()
    company_ids = set()
    if user.company_id and user.role == 'company_admin':
        company_ids.add(user.company_id)
    for g in user_grants(user):
        if g.scope_type == 'company':
            company_ids.add(g.scope_id)
        elif g.scope_type == 'department':
            d = db.session.get(Department, g.scope_id)
            if d:
                company_ids.add(d.company_id)
        elif g.scope_type == 'board':
            b = db.session.get(Board, g.scope_id)
            if b:
                cid = board_company_id(b)
                if cid:
                    company_ids.add(cid)
        elif g.scope_type == 'item':
            i = db.session.get(Item, g.scope_id)
            if i:
                b = db.session.get(Board, i.board_id)
                cid = board_company_id(b) if b else None
                if cid:
                    company_ids.add(cid)
    # assignment-based visibility can reach boards with no explicit grant
    for b in Board.query.all():
        if b.id not in _granted_board_ids(user) and _assigned_item_ids_on_board(user, b.id):
            cid = board_company_id(b)
            if cid:
                company_ids.add(cid)
    if not company_ids:
        return []
    return (Company.query.filter(Company.id.in_(company_ids))
            .order_by(Company.position, Company.id).all())


def accessible_boards_in(user, department):
    boards = (Board.query.filter_by(department_id=department.id)
              .order_by(Board.position, Board.id).all())
    return _filter_boards(user, boards)


def accessible_direct_boards(user, company):
    """Boards attached straight to a company (no department)."""
    boards = (Board.query.filter_by(company_id=company.id, department_id=None)
              .order_by(Board.position, Board.id).all())
    return _filter_boards(user, boards)


def _filter_boards(user, boards):
    if is_super(user):
        return [(b, 'full') for b in boards]
    out = []
    for b in boards:
        access = board_access(user, b)
        if access:
            out.append((b, access))
    return out


def visible_users(user):
    """Who a user may see in people pickers etc. Same company + IT staff;
    supers see everyone."""
    if is_super(user):
        return User.query.order_by(User.display_name).all()
    q = User.query.filter(
        db.or_(User.company_id == user.company_id, User.company_id.is_(None)))
    return q.order_by(User.display_name).all()
