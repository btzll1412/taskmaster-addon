"""One-time migration of TaskMaster v2 data (projects/tasks) into the v3 board schema.

v2 and v3 share the same SQLite file, so the old tables (`project`, `task`, ...)
are read in place. Runs only when the new `boards` table is empty and old data
exists; old tables are left untouched as a backup.
"""
import json
from datetime import datetime

from sqlalchemy import inspect, text

from .db import db
from .models import (Board, BoardColumn, BoardGroup, FileAsset, Item,
                     ItemUpdate, ItemValue, User)

MIGRATED_STATUS_LABELS = [
    {'id': 'l1', 'label': 'Not Started', 'color': '#c4c4c4'},
    {'id': 'l2', 'label': 'Working on it', 'color': '#fdab3d'},
    {'id': 'l5', 'label': 'Ongoing', 'color': '#a25ddc'},
    {'id': 'l3', 'label': 'Stuck', 'color': '#e2445c'},
    {'id': 'l4', 'label': 'Done', 'color': '#00c875'},
]
STATUS_MAP = {'starting': 'l1', 'in_progress': 'l2', 'ongoing': 'l5', 'done': 'l4'}
PRIORITY_MAP = {'high': 'p2', 'medium': 'p3', 'low': 'p4'}
PRIORITY_LABELS = [
    {'id': 'p1', 'label': 'Critical', 'color': '#333333'},
    {'id': 'p2', 'label': 'High', 'color': '#401694'},
    {'id': 'p3', 'label': 'Medium', 'color': '#5559df'},
    {'id': 'p4', 'label': 'Low', 'color': '#579bfc'},
]


def _rows(sql, **params):
    return db.session.execute(text(sql), params).mappings().all()


def _parse_dt(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace('Z', ''))
    except ValueError:
        return None


def migrate_v2_if_needed():
    inspector = inspect(db.engine)
    tables = set(inspector.get_table_names())
    if 'project' not in tables or Board.query.first() is not None:
        return
    if not _rows('SELECT id FROM project LIMIT 1') and not _rows('SELECT id FROM user LIMIT 1'):
        return

    print('TaskMaster: migrating v2 data to v3 boards...')

    # --- Users (no passwords in v2 — admin sets them after first login) ---
    user_map = {}
    for row in _rows('SELECT * FROM user'):
        existing = User.query.filter_by(username=row['username']).first()
        if existing:
            user_map[row['id']] = existing.id
            continue
        u = User(
            username=row['username'],
            display_name=row['display_name'] or row['username'],
            color=row['color'] or '#579bfc',
            role='member',
            created_at=_parse_dt(row['created_at']) or datetime.utcnow(),
        )
        db.session.add(u)
        db.session.flush()
        user_map[row['id']] = u.id

    for row in _rows('SELECT * FROM project ORDER BY id'):
        board = Board(
            name=row['name'],
            description=row['description'] or '',
            archived=(row['status'] == 'completed'),
            owner_id=user_map.get(row['created_by']),
            position=row['id'],
            created_at=_parse_dt(row['created_at']) or datetime.utcnow(),
        )
        db.session.add(board)
        db.session.flush()

        g_todo = BoardGroup(board_id=board.id, name='To-Do', color='#579bfc', position=1)
        g_done = BoardGroup(board_id=board.id, name='Completed', color='#00c875', position=2)
        db.session.add_all([g_todo, g_done])
        db.session.flush()

        col_status = BoardColumn(board_id=board.id, title='Status', type='status',
                                 settings=json.dumps({'labels': MIGRATED_STATUS_LABELS}),
                                 position=1, width=150)
        col_people = BoardColumn(board_id=board.id, title='People', type='people',
                                 settings='{}', position=2, width=130)
        col_date = BoardColumn(board_id=board.id, title='Due date', type='date',
                               settings='{}', position=3, width=140)
        col_prio = BoardColumn(board_id=board.id, title='Priority', type='priority',
                               settings=json.dumps({'labels': PRIORITY_LABELS}),
                               position=4, width=140)
        db.session.add_all([col_status, col_people, col_date, col_prio])

        # Project tags (project-specific + global) → dropdown column
        col_tags = None
        tag_option_map = {}
        if 'tags' in tables:
            tag_rows = _rows(
                'SELECT * FROM tags WHERE project_id = :pid OR project_id IS NULL', pid=row['id'])
            if tag_rows:
                options = []
                for t in tag_rows:
                    oid = f"t{t['id']}"
                    tag_option_map[t['id']] = oid
                    options.append({'id': oid, 'label': t['name'], 'color': t['color'] or '#579bfc'})
                col_tags = BoardColumn(board_id=board.id, title='Tags', type='dropdown',
                                       settings=json.dumps({'options': options}),
                                       position=5, width=160)
                db.session.add(col_tags)
        db.session.flush()

        for t in _rows('SELECT * FROM task WHERE project_id = :pid ORDER BY id', pid=row['id']):
            group = g_done if t['status'] == 'done' else g_todo
            item = Item(
                board_id=board.id, group_id=group.id, name=t['title'],
                position=t['id'], created_by=user_map.get(t['created_by']),
                created_at=_parse_dt(t['created_at']) or datetime.utcnow(),
            )
            db.session.add(item)
            db.session.flush()

            def set_value(col, value):
                db.session.add(ItemValue(item_id=item.id, column_id=col.id,
                                         value=json.dumps(value)))

            if t['status'] in STATUS_MAP:
                set_value(col_status, {'id': STATUS_MAP[t['status']]})
            if t['priority'] in PRIORITY_MAP:
                set_value(col_prio, {'id': PRIORITY_MAP[t['priority']]})

            assignees = set()
            if t['assigned_to'] and t['assigned_to'] in user_map:
                assignees.add(user_map[t['assigned_to']])
            if 'task_assignment' in tables:
                for a in _rows('SELECT user_id FROM task_assignment WHERE task_id = :tid', tid=t['id']):
                    if a['user_id'] in user_map:
                        assignees.add(user_map[a['user_id']])
            if assignees:
                set_value(col_people, {'user_ids': sorted(assignees)})

            due = _parse_dt(t['estimated_completion'])
            if due:
                set_value(col_date, {'date': due.date().isoformat()})

            if col_tags is not None and 'task_tags' in tables:
                tag_ids = [tag_option_map[r['tag_id']]
                           for r in _rows('SELECT tag_id FROM task_tags WHERE task_id = :tid', tid=t['id'])
                           if r['tag_id'] in tag_option_map]
                if tag_ids:
                    set_value(col_tags, {'ids': tag_ids})

            # Description becomes the first update on the item
            if t['description']:
                db.session.add(ItemUpdate(
                    item_id=item.id, user_id=user_map.get(t['created_by']),
                    body=t['description'],
                    created_at=_parse_dt(t['created_at']) or datetime.utcnow(),
                ))

            if 'subtasks' in tables:
                subs = _rows('SELECT * FROM subtasks WHERE task_id = :tid ORDER BY position', tid=t['id'])
                if subs:
                    lines = ['Checklist (migrated):']
                    for s in subs:
                        mark = 'x' if s['completed'] else ' '
                        lines.append(f"- [{mark}] {s['title']}")
                    db.session.add(ItemUpdate(item_id=item.id,
                                              user_id=user_map.get(t['created_by']),
                                              body='\n'.join(lines)))

            if 'note' in tables:
                for n in _rows('SELECT * FROM note WHERE task_id = :tid ORDER BY id', tid=t['id']):
                    db.session.add(ItemUpdate(
                        item_id=item.id, user_id=user_map.get(n['user_id']),
                        body=n['content'],
                        created_at=_parse_dt(n['created_at']) or datetime.utcnow(),
                    ))

            if 'task_images' in tables:
                for img in _rows('SELECT * FROM task_images WHERE task_id = :tid', tid=t['id']):
                    db.session.add(FileAsset(
                        item_id=item.id, user_id=user_map.get(img['user_id']),
                        filename=img['filename'],
                        original_filename=img['original_filename'] or img['filename'],
                        mime_type=img['mime_type'], file_size=img['file_size'],
                        created_at=_parse_dt(img['created_at']) or datetime.utcnow(),
                    ))

    db.session.commit()
    print('TaskMaster: v2 migration complete.')
