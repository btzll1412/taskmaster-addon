import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import TableView from '../components/TableView'
import KanbanView from '../components/KanbanView'
import CalendarView from '../components/CalendarView'
import NewJobModal from '../components/NewJobModal'
import { Avatar, OverlayPopover, Popover, Spinner } from '../components/ui'

export default function BoardView() {
  const { boardData, boardLoading, route, users, workspace, refreshBoard, refreshBoards, navigate, showToast } = useStore()
  const [showNewJob, setShowNewJob] = useState(false)
  const boardId = route.boardId
  const [view, setView] = useState(() => localStorage.getItem(`tm-view-${boardId}`) || 'table')
  const [search, setSearch] = useState('')
  const [personFilter, setPersonFilter] = useState(null)
  const [statusFilter, setStatusFilter] = useState(() => new Set())
  const [sortBy, setSortBy] = useState(() => localStorage.getItem(`tm-sort-${boardId}`) || 'manual')
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)

  const ready = !boardLoading && boardData && boardData.board.id === boardId
  const board = ready ? boardData.board : null
  const columns = ready ? boardData.columns : []
  const items = ready ? boardData.items : []
  const { user } = useStore()
  const cap = (c) => (user.capabilities || []).includes(c)
  const fullAccess = ready && boardData.access === 'full'
  const canEdit = fullAccess && cap('manage_boards')      // structure: groups, columns, automations
  const canCreate = fullAccess && cap('create_jobs')      // add jobs
  const canEditItems = cap('edit_jobs')                   // change values, updates, files
  const dept = ready ? boardData.department : null
  const company = dept ? workspace.companies.find(c => c.id === dept.company_id) : null

  const statusCol = columns.find(c => c.type === 'status')
  const statusLabels = statusCol?.settings?.labels || []

  // job-scoped people eligibility (from the board payload)
  const assignable = ready ? boardData.assignable : null
  const usersFor = (item) => {
    if (!assignable) return []
    const ids = new Set(assignable.board_ids)
    for (const id of (assignable.item_ids[String(item.id)] || [])) ids.add(id)
    if (item.parent_id) for (const id of (assignable.item_ids[String(item.parent_id)] || [])) ids.add(id)
    const out = [...ids].map(id => assignable.users[String(id)]).filter(Boolean)
    // keep already-assigned people resolvable even if their grant was removed
    for (const cid of columns.filter(c => c.type === 'people').map(c => String(c.id))) {
      for (const uid of (item.values[cid]?.user_ids || [])) {
        if (!ids.has(uid)) {
          const u = assignable.users[String(uid)] || users.find(x => x.id === uid)
          if (u) { out.push(u); ids.add(uid) }
        }
      }
    }
    return out
  }

  const filtered = useMemo(() => {
    const peopleColIds = columns.filter(c => c.type === 'people').map(c => String(c.id))
    const doneIds = new Set(statusLabels.filter(l => l.label.toLowerCase() === 'done').map(l => l.id))
    const keep = (i) => {
      if (search.trim() && !i.name.toLowerCase().includes(search.trim().toLowerCase())) return false
      if (personFilter && !peopleColIds.some(cid =>
        (i.values[cid]?.user_ids || []).includes(personFilter))) return false
      if (statusCol) {
        const sid = i.values[String(statusCol.id)]?.id ?? null
        if (statusFilter.size > 0 && !statusFilter.has(sid ?? '__none__')) return false
        if (user.hide_done && statusFilter.size === 0 && sid && doneIds.has(sid)) return false
      }
      return true
    }
    // filters apply to jobs; their sub-tasks follow the parent
    const keptTops = new Set(items.filter(i => !i.parent_id && keep(i)).map(i => i.id))
    let out = items.filter(i => i.parent_id ? keptTops.has(i.parent_id) : keptTops.has(i.id))

    if (sortBy !== 'manual') {
      const dateCol = columns.find(c => c.type === 'date')
      const prioCol = columns.find(c => c.type === 'priority')
      const prioOrder = new Map((prioCol?.settings?.labels || []).map((l, i) => [l.id, i]))
      const statusOrder = new Map(statusLabels.map((l, i) => [l.id, i]))
      const key = (i) => {
        if (sortBy === 'due') {
          const d = dateCol && i.values[String(dateCol.id)]?.date
          return d || '9999-12-31'
        }
        if (sortBy === 'priority') {
          const id = prioCol && i.values[String(prioCol.id)]?.id
          return prioOrder.has(id) ? prioOrder.get(id) : 99
        }
        if (sortBy === 'status') {
          const id = statusCol && i.values[String(statusCol.id)]?.id
          return statusOrder.has(id) ? statusOrder.get(id) : 99
        }
        return i.name.toLowerCase()
      }
      const tops = out.filter(i => !i.parent_id)
        .sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)
      const subs = out.filter(i => i.parent_id)
      out = tops.flatMap(t => [t, ...subs.filter(s => s.parent_id === t.id)])
    }
    return out
  }, [items, search, personFilter, statusFilter, columns, user.hide_done, sortBy])

  // "+ Add job" from a company/department page lands here asking for the popup
  useEffect(() => {
    if (ready && route.newJob && fullAccess && cap('create_jobs')) {
      setShowNewJob(true)
      navigate({ page: 'board', boardId }, { fromHistory: true })
    }
  }, [ready, route.newJob])

  if (!ready) {
    return <div className="board-loading"><Spinner /></div>
  }

  function switchView(v) {
    setView(v)
    localStorage.setItem(`tm-view-${boardId}`, v)
  }

  async function act(promise) {
    try { await promise; await refreshBoard(); await refreshBoards() } catch (e) { showToast(e.message) }
  }

  const activeUsers = assignable
    ? assignable.board_ids.map(id => assignable.users[String(id)]).filter(u => u && u.is_active)
    : users.filter(u => u.is_active)

  return (
    <div className="board-view">
      <div className="board-head">
        {(company || dept) && (
          <div className="breadcrumb">
            {company && <span>{company.name}</span>}
            {company && dept && <span className="crumb-sep">/</span>}
            {dept && <span>{dept.icon} {dept.name}</span>}
          </div>
        )}
        <div className="board-title-row">
          <span className="board-icon">{board.icon}</span>
          {renaming && canEdit ? (
            <input className="board-rename" autoFocus defaultValue={board.name}
              onBlur={e => { setRenaming(false); const v = e.target.value.trim(); if (v && v !== board.name) act(api.put(`/api/boards/${board.id}`, { name: v })) }}
              onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setRenaming(false) }} />
          ) : (
            <h2 onClick={() => canEdit && setRenaming(true)} title={canEdit ? 'Click to rename' : undefined}>{board.name}</h2>
          )}
          <BoardStatusButton board={board} labels={statusLabels}
            canSet={fullAccess && canEditItems} act={act} />
          {!canEdit && <span className="archived-tag" title="You see only the jobs shared with you">Limited access</span>}
          {board.archived && <span className="archived-tag">Archived</span>}
          <div className="topbar-anchor" style={canEdit ? undefined : { display: 'none' }}>
            <button className="icon-btn" onClick={() => setMenu(true)}>⋯</button>
            {menu && (
              <Popover onClose={() => setMenu(false)} width={210}>
                <button className="menu-item" onClick={() => { setMenu(false); setRenaming(true) }}>✏️ Rename board</button>
                <button className="menu-item"
                  onClick={() => { setMenu(false); act(api.put(`/api/boards/${board.id}`, { archived: !board.archived })) }}>
                  {board.archived ? '📤 Unarchive board' : '🗃️ Archive board'}
                </button>
                <hr className="menu-sep" />
                <button className="menu-item menu-danger"
                  onClick={async () => {
                    setMenu(false)
                    if (!confirm(`Permanently delete "${board.name}" and everything on it?`)) return
                    try {
                      await api.del(`/api/boards/${board.id}`)
                      await refreshBoards()
                      navigate({ page: 'home' })
                    } catch (e) { showToast(e.message) }
                  }}>
                  🗑️ Delete board
                </button>
              </Popover>
            )}
          </div>
        </div>
        {board.description && <p className="board-desc">{board.description}</p>}

        <div className="view-tabs">
          <button className={view === 'table' ? 'active' : ''} onClick={() => switchView('table')}>
            <span className="tab-icon">🏠</span> Main table
          </button>
          <button className={view === 'kanban' ? 'active' : ''} onClick={() => switchView('kanban')}>
            <span className="tab-icon">🗂</span> Kanban
          </button>
          <button className={view === 'calendar' ? 'active' : ''} onClick={() => switchView('calendar')}>
            <span className="tab-icon">📅</span> Calendar
          </button>
        </div>

        <div className="board-toolbar">
          {canCreate && <button className="btn btn-primary" onClick={() => setShowNewJob(true)}>＋ New job</button>}
          <select className="board-sort" value={sortBy} title="Sort jobs"
            onChange={e => { setSortBy(e.target.value); localStorage.setItem(`tm-sort-${boardId}`, e.target.value) }}>
            <option value="manual">↕️ Manual order</option>
            <option value="due">📅 By due date</option>
            <option value="priority">🚩 By priority</option>
            <option value="status">🟢 By status</option>
            <option value="name">🔤 By name</option>
          </select>
          <input className="board-search" placeholder="🔍 Search this board"
            value={search} onChange={e => setSearch(e.target.value)} />
          <div className="person-filter">
            {activeUsers.slice(0, 8).map(u => (
              <button key={u.id} className={`person-filter-btn ${personFilter === u.id ? 'active' : ''}`}
                title={`Filter by ${u.display_name}`}
                onClick={() => setPersonFilter(personFilter === u.id ? null : u.id)}>
                <Avatar user={u} size={26} />
              </button>
            ))}
          </div>
          {(search || personFilter || statusFilter.size > 0) && (
            <button className="link-btn" onClick={() => { setSearch(''); setPersonFilter(null); setStatusFilter(new Set()) }}>Clear filters</button>
          )}
          <span className="toolbar-count muted">{filtered.length} / {items.length} items</span>
        </div>

        {statusLabels.length > 0 && (
          <div className="status-filter-bar">
            <span className="muted status-filter-label">Status:</span>
            {statusLabels.map(l => (
              <button key={l.id}
                className={`status-filter-chip ${statusFilter.has(l.id) ? 'active' : ''}`}
                style={{ '--chip-color': l.color }}
                onClick={() => {
                  const next = new Set(statusFilter)
                  next.has(l.id) ? next.delete(l.id) : next.add(l.id)
                  setStatusFilter(next)
                }}>
                {l.label}
              </button>
            ))}
            <button
              className={`status-filter-chip ${statusFilter.has('__none__') ? 'active' : ''}`}
              style={{ '--chip-color': '#c4c4c4' }}
              onClick={() => {
                const next = new Set(statusFilter)
                next.has('__none__') ? next.delete('__none__') : next.add('__none__')
                setStatusFilter(next)
              }}>
              No status
            </button>
          </div>
        )}
      </div>

      {view === 'table' && <TableView items={filtered} canEdit={canEdit} canCreate={canCreate}
        canEditItems={canEditItems} canReorder={canEditItems && sortBy === 'manual'} usersFor={usersFor} />}
      {view === 'kanban' && <KanbanView items={filtered} canEdit={canEdit} canEditItems={canEditItems} usersFor={usersFor} />}
      {view === 'calendar' && <CalendarView items={filtered} />}

      {showNewJob && (
        <NewJobModal board={board} assignableUsers={activeUsers}
          onClose={() => setShowNewJob(false)}
          onCreated={async () => { setShowNewJob(false); await refreshBoard() }}
          showToast={showToast} />
      )}
    </div>
  )
}

/** Status of the entire board/job, shown next to its name. Uses the board's own
 * status labels so it matches what the rows use. */
function BoardStatusButton({ board, labels, canSet, act }) {
  const [open, setOpen] = useState(false)
  const anchor = useRef(null)
  const options = labels.length > 0 ? labels : [
    { id: '_w', label: 'Working on it', color: '#fdab3d' },
    { id: '_s', label: 'Stuck', color: '#e2445c' },
    { id: '_d', label: 'Done', color: '#00c875' },
  ]
  const current = board.status
  if (!canSet && !current) return null
  const done = options.find(l => l.label.trim().toLowerCase() === 'done')
  const set = (value) => {
    setOpen(false)
    act(api.put(`/api/boards/${board.id}/status`, { status: value }))
  }
  return (
    <div className="topbar-anchor" ref={anchor}>
      <button
        className={`btn btn-small ${current ? 'btn-status-current' : 'btn-mark-done'}`}
        style={current ? { background: current.color, borderColor: current.color, color: '#fff' } : undefined}
        title="Status of this whole job board" disabled={!canSet}
        onClick={() => canSet && setOpen(true)}>
        {current ? current.label : done ? '✓ Mark done' : '＋ Status'}
      </button>
      {open && (
        <OverlayPopover anchorRef={anchor} onClose={() => setOpen(false)} width={200}>
          {options.map(l => (
            <button key={l.id} className="label-option" style={{ background: l.color }}
              onClick={() => set({ label: l.label, color: l.color })}>
              {l.label}{current?.label === l.label ? ' ✓' : ''}
            </button>
          ))}
          {current && (
            <button className="label-option label-clear" onClick={() => set(null)}>
              Clear status
            </button>
          )}
        </OverlayPopover>
      )}
    </div>
  )
}
