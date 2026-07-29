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
                     Item, ItemValue, Role, User)

# Capability keys a role can carry
CAP_CREATE = 'create_jobs'      # add jobs / sub-tasks
CAP_EDIT = 'edit_jobs'          # change statuses/values, write updates, upload files
CAP_BOARDS = 'manage_boards'    # create/edit boards, groups, columns, automations
CAP_USERS = 'manage_users'      # create/manage users in own company
CAP_ACCESS = 'manage_access'    # grant/revoke access in own company
CAP_COMPANY = 'manage_company'  # edit company details / departments
ALL_CAPS = {CAP_CREATE, CAP_EDIT, CAP_BOARDS, CAP_USERS, CAP_ACCESS, CAP_COMPANY}

LEVEL_CAPS = {
    'super_admin': ALL_CAPS,
    'admin': ALL_CAPS,
    'company_admin': ALL_CAPS,
    'member': {CAP_CREATE, CAP_EDIT, CAP_BOARDS},
    'viewer': set(),
}


def is_super(user):
    return user.role == 'super_admin'


def caps(user):
    """Effective capability set: custom role if assigned, else base level."""
    if user.custom_role_id:
        r = db.session.get(Role, user.custom_role_id)
        if r:
            return set(r.permission_list())
    return LEVEL_CAPS.get(user.role, set())


def has_cap(user, cap):
    return cap in caps(user)


def can_write(user):
    """Users whose role carries no capabilities are read-only everywhere."""
    return bool(caps(user))


def user_grants(user):
    return AccessGrant.query.filter_by(user_id=user.id).all()


def has_all_access(user):
    """IT staff granted every company ('all sites')."""
    return any(g.scope_type == 'all' for g in user_grants(user))


def managed_company_ids(user):
    """Companies an IT-staff admin manages (via 'all' or company grants)."""
    if user.role != 'admin':
        return set()
    if has_all_access(user):
        return {c.id for c in Company.query.all()}
    return {g.scope_id for g in user_grants(user) if g.scope_type == 'company'}


def board_company_id(board):
    if board.department_id:
        dept = db.session.get(Department, board.department_id)
        return dept.company_id if dept else board.company_id
    return board.company_id


def _granted_board_ids(user):
    """Board ids covered by full-board-or-wider grants."""
    grants = user_grants(user)
    if any(g.scope_type == 'all' for g in grants):
        return {b.id for b in Board.query.all()}
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
    """Structural board changes: groups, columns, automations, board settings."""
    return has_cap(user, CAP_BOARDS) and board_access(user, board) == 'full'


def can_manage_company(user, company_id):
    if is_super(user):
        return True
    if user.role == 'admin' and company_id in managed_company_ids(user):
        return True
    if user.role == 'company_admin' and user.company_id == company_id:
        return True
    # custom role carrying the manage-company capability, within own company
    return user.company_id == company_id and has_cap(user, CAP_COMPANY)


def can_manage_user(actor, target):
    if is_super(actor):
        return True
    if target.role in ('super_admin', 'admin'):
        return False
    if actor.role == 'admin':
        return target.company_id in managed_company_ids(actor)
    if actor.company_id and target.company_id == actor.company_id:
        # company admins, or any company user whose role carries manage_users
        return actor.role == 'company_admin' or has_cap(actor, CAP_USERS)
    return False


def accessible_companies(user):
    if is_super(user) or has_all_access(user):
        return Company.query.order_by(Company.position, Company.id).all()
    company_ids = set()
    company_ids |= managed_company_ids(user)
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
    supers (and all-access staff) see everyone."""
    if is_super(user) or has_all_access(user):
        return User.query.order_by(User.display_name).all()
    if user.role == 'admin':
        managed = managed_company_ids(user)
        q = User.query.filter(
            db.or_(User.company_id.in_(managed) if managed else db.false(),
                   User.company_id.is_(None)))
        return q.order_by(User.display_name).all()
    q = User.query.filter(
        db.or_(User.company_id == user.company_id, User.company_id.is_(None)))
    return q.order_by(User.display_name).all()


def can_grant_in_company(actor, company_id):
    """May the actor create/remove grants scoped to this company?"""
    if is_super(actor):
        return True
    if actor.role == 'admin':
        return company_id in managed_company_ids(actor)
    if actor.company_id == company_id:
        return actor.role == 'company_admin' or has_cap(actor, CAP_ACCESS)
    return False


def board_assignable(board):
    """Who may be assigned/flagged on this board.

    Returns (board_wide_users, {item_id: [users]}):
    - board_wide: the board's company employees + IT staff / outsiders whose
      grants cover the whole board or wider
    - per-item: people whose only access is a single-job grant — they are
      assignable on exactly that job (and its sub-tasks)
    """
    company_id = board_company_id(board)
    board_users, item_extra = [], {}
    for u in User.query.filter_by(is_active=True).all():
        if u.company_id == company_id:
            board_users.append(u)
            continue
        if is_super(u) or board.id in _granted_board_ids(u):
            board_users.append(u)
            continue
        granted_items = [g.scope_id for g in AccessGrant.query.filter_by(
            user_id=u.id, scope_type='item').all()]
        if granted_items:
            jobs = Item.query.filter(Item.id.in_(granted_items),
                                     Item.board_id == board.id).all()
            for job in jobs:
                item_extra.setdefault(job.id, []).append(u)
                for sub in Item.query.filter_by(parent_id=job.id).all():
                    item_extra.setdefault(sub.id, []).append(u)
    return board_users, item_extra


def eligible_assignee_ids(item):
    """User ids that may be assigned/flagged on this specific job."""
    board = db.session.get(Board, item.board_id)
    if not board:
        return set()
    board_users, item_extra = board_assignable(board)
    ids = {u.id for u in board_users}
    ids |= {u.id for u in item_extra.get(item.id, [])}
    return ids


def can_create_board_in(user, company_id, dept_id=None):
    """May the user create a board directly in this company / department?"""
    if is_super(user) or can_manage_company(user, company_id):
        return True
    if not has_cap(user, CAP_BOARDS):
        return False
    for g in user_grants(user):
        if g.scope_type == 'all':
            return True
        if g.scope_type == 'company' and g.scope_id == company_id:
            return True
        if dept_id and g.scope_type == 'department' and g.scope_id == dept_id:
            return True
    return False
