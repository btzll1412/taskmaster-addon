import React, { useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { Modal, EmojiPicker } from './ui'

export default function Sidebar() {
  const { boards, route, navigate, refreshBoards, openBoard, showToast, sidebarMobile, toggleSidebarMobile } = useStore()
  const [showNew, setShowNew] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('📋')
  const [collapsed, setCollapsed] = useState(localStorage.getItem('tm-sidebar') === '1')

  const active = boards.filter(b => !b.archived)
  const archived = boards.filter(b => b.archived)

  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('tm-sidebar', next ? '1' : '0')
  }

  async function createBoard(e) {
    e.preventDefault()
    if (!name.trim()) return
    try {
      const data = await api.post('/api/boards', { name: name.trim(), icon })
      setShowNew(false); setName(''); setIcon('📋')
      await refreshBoards()
      openBoard(data.board.id)
    } catch (err) { showToast(err.message) }
  }

  return (
    <>
    {sidebarMobile && <div className="sidebar-backdrop" onClick={toggleSidebarMobile} />}
    <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''} ${sidebarMobile ? 'mobile-open' : ''}`}>
      <div className="sidebar-brand" onClick={toggle} title="Toggle sidebar">
        <span className="brand-icon">✅</span>
        {!collapsed && <span className="brand-name">TaskMaster</span>}
      </div>

      <nav className="sidebar-nav">
        <button className={`nav-item ${route.page === 'home' ? 'active' : ''}`}
          onClick={() => navigate({ page: 'home' })} title="Home">
          <span className="nav-icon">🏡</span>{!collapsed && 'Home'}
        </button>
        <button className={`nav-item ${route.page === 'mywork' ? 'active' : ''}`}
          onClick={() => navigate({ page: 'mywork' })} title="My Work">
          <span className="nav-icon">🗂️</span>{!collapsed && 'My Work'}
        </button>
      </nav>

      <div className="sidebar-section">
        {!collapsed && <div className="section-title">
          <span>Boards</span>
          <button className="icon-btn" title="New board" onClick={() => setShowNew(true)}>＋</button>
        </div>}
        {collapsed && <button className="nav-item" title="New board" onClick={() => setShowNew(true)}>＋</button>}
        <div className="board-list">
          {active.map(b => (
            <button key={b.id}
              className={`nav-item board-item ${route.page === 'board' && route.boardId === b.id ? 'active' : ''}`}
              onClick={() => openBoard(b.id)} title={b.name}>
              <span className="nav-icon">{b.icon}</span>
              {!collapsed && <span className="board-item-name">{b.name}</span>}
              {!collapsed && b.items_count > 0 && <span className="board-count">{b.items_count}</span>}
            </button>
          ))}
          {active.length === 0 && !collapsed &&
            <div className="sidebar-empty">No boards yet.<br />Create your first one!</div>}
        </div>
        {archived.length > 0 && !collapsed && (
          <>
            <button className="nav-item nav-muted" onClick={() => setShowArchived(!showArchived)}>
              <span className="nav-icon">🗃️</span>Archived ({archived.length})
            </button>
            {showArchived && archived.map(b => (
              <button key={b.id}
                className={`nav-item board-item nav-muted ${route.page === 'board' && route.boardId === b.id ? 'active' : ''}`}
                onClick={() => openBoard(b.id)}>
                <span className="nav-icon">{b.icon}</span>
                <span className="board-item-name">{b.name}</span>
              </button>
            ))}
          </>
        )}
      </div>

      {showNew && (
        <Modal title="Create board" onClose={() => setShowNew(false)}>
          <form onSubmit={createBoard} className="form-col">
            <div className="form-row">
              <EmojiPicker value={icon} onChange={setIcon} />
              <input placeholder="Board name" value={name} autoFocus
                onChange={e => setName(e.target.value)} required />
            </div>
            <button className="btn btn-primary">Create board</button>
          </form>
        </Modal>
      )}
    </aside>
    </>
  )
}
