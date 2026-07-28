import React, { useMemo, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import TableView from '../components/TableView'
import KanbanView from '../components/KanbanView'
import { Avatar, Popover, Spinner } from '../components/ui'

export default function BoardView() {
  const { boardData, boardLoading, route, users, refreshBoard, refreshBoards, navigate, showToast } = useStore()
  const boardId = route.boardId
  const [view, setView] = useState(() => localStorage.getItem(`tm-view-${boardId}`) || 'table')
  const [search, setSearch] = useState('')
  const [personFilter, setPersonFilter] = useState(null)
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)

  const ready = !boardLoading && boardData && boardData.board.id === boardId
  const board = ready ? boardData.board : null
  const columns = ready ? boardData.columns : []
  const items = ready ? boardData.items : []

  const filtered = useMemo(() => {
    const peopleColIds = columns.filter(c => c.type === 'people').map(c => String(c.id))
    let out = items
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      out = out.filter(i => i.name.toLowerCase().includes(q))
    }
    if (personFilter) {
      out = out.filter(i => peopleColIds.some(cid =>
        (i.values[cid]?.user_ids || []).includes(personFilter)))
    }
    return out
  }, [items, search, personFilter, columns])

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

  const activeUsers = users.filter(u => u.is_active)

  return (
    <div className="board-view">
      <div className="board-head">
        <div className="board-title-row">
          <span className="board-icon">{board.icon}</span>
          {renaming ? (
            <input className="board-rename" autoFocus defaultValue={board.name}
              onBlur={e => { setRenaming(false); const v = e.target.value.trim(); if (v && v !== board.name) act(api.put(`/api/boards/${board.id}`, { name: v })) }}
              onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setRenaming(false) }} />
          ) : (
            <h2 onClick={() => setRenaming(true)} title="Click to rename">{board.name}</h2>
          )}
          {board.archived && <span className="archived-tag">Archived</span>}
          <div className="topbar-anchor">
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

        <div className="board-toolbar">
          <div className="view-tabs">
            <button className={view === 'table' ? 'active' : ''} onClick={() => switchView('table')}>☰ Table</button>
            <button className={view === 'kanban' ? 'active' : ''} onClick={() => switchView('kanban')}>🗂 Kanban</button>
          </div>
          <input className="board-search" placeholder="🔍 Filter items…"
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
          {(search || personFilter) && (
            <button className="link-btn" onClick={() => { setSearch(''); setPersonFilter(null) }}>Clear</button>
          )}
        </div>
      </div>

      {view === 'table'
        ? <TableView items={filtered} />
        : <KanbanView items={filtered} />}
    </div>
  )
}
