import React, { useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { Modal, EmojiPicker } from './ui'

export default function Sidebar() {
  const { user, workspace, route, navigate, refreshBoards, openBoard, showToast,
    sidebarMobile, toggleSidebarMobile } = useStore()
  const [newBoardDept, setNewBoardDept] = useState(null)
  const [newDeptCompany, setNewDeptCompany] = useState(null)
  const [showNewCompany, setShowNewCompany] = useState(false)
  const [collapsedCompanies, setCollapsedCompanies] = useState(() => {
    try { return JSON.parse(localStorage.getItem('tm-collapsed-companies') || '[]') } catch { return [] }
  })

  const canManage = (companyId) =>
    user.role === 'super_admin' ||
    (user.role === 'company_admin' && user.company_id === companyId)

  function toggleCompany(id) {
    const next = collapsedCompanies.includes(id)
      ? collapsedCompanies.filter(c => c !== id)
      : [...collapsedCompanies, id]
    setCollapsedCompanies(next)
    localStorage.setItem('tm-collapsed-companies', JSON.stringify(next))
  }

  return (
    <>
      {sidebarMobile && <div className="sidebar-backdrop" onClick={toggleSidebarMobile} />}
      <aside className={`sidebar ${sidebarMobile ? 'mobile-open' : ''}`}>
        <div className="sidebar-brand">
          <span className="brand-icon">✅</span>
          <span className="brand-name">TaskMaster</span>
        </div>

        <nav className="sidebar-nav">
          <button className={`nav-item ${route.page === 'home' ? 'active' : ''}`}
            onClick={() => navigate({ page: 'home' })}>
            <span className="nav-icon">🏡</span>Home
          </button>
          <button className={`nav-item ${route.page === 'mywork' ? 'active' : ''}`}
            onClick={() => navigate({ page: 'mywork' })}>
            <span className="nav-icon">🗂️</span>My Work
          </button>
        </nav>

        <div className="sidebar-section">
          {workspace.companies.map(c => (
            <div key={c.id} className="company-block">
              <div className="company-head" style={{ '--company-color': c.color }}>
                <button className="company-toggle" onClick={() => toggleCompany(c.id)}>
                  {collapsedCompanies.includes(c.id) ? '▸' : '▾'}
                </button>
                <span className="company-name" title={c.name}>{c.name}</span>
                {canManage(c.id) && (
                  <button className="icon-btn tree-add" title="New department"
                    onClick={() => setNewDeptCompany(c)}>＋</button>
                )}
              </div>
              {!collapsedCompanies.includes(c.id) && c.departments.map(d => (
                <div key={d.id} className="dept-block">
                  <div className="dept-head">
                    <span className="dept-name" title={d.name}>{d.icon} {d.name}</span>
                    {(canManage(c.id) || d.boards.length > 0) && (
                      <button className="icon-btn tree-add" title="New board"
                        onClick={() => setNewBoardDept(d)}>＋</button>
                    )}
                  </div>
                  {d.boards.filter(b => !b.archived).map(b => (
                    <button key={b.id}
                      className={`nav-item board-item ${route.page === 'board' && route.boardId === b.id ? 'active' : ''}`}
                      onClick={() => openBoard(b.id)} title={b.name}>
                      <span className="nav-icon">{b.icon}</span>
                      <span className="board-item-name">{b.name}</span>
                      {b.access === 'partial'
                        ? <span className="board-count" title="You can see specific items only">🔒</span>
                        : b.items_count > 0 && <span className="board-count">{b.items_count}</span>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ))}

          {workspace.companies.length === 0 && (
            <div className="sidebar-empty">
              {workspace.can_create_companies
                ? 'Create your first company to get started.'
                : 'Nothing shared with you yet.'}
            </div>
          )}

          {workspace.can_create_companies && (
            <button className="nav-item nav-muted" onClick={() => setShowNewCompany(true)}>
              <span className="nav-icon">＋</span>New company
            </button>
          )}
        </div>

        {showNewCompany && (
          <NameModal title="Create company" placeholder="Company name"
            onClose={() => setShowNewCompany(false)}
            onSubmit={async (name) => {
              await api.post('/api/companies', { name })
              setShowNewCompany(false); refreshBoards()
            }} showToast={showToast} />
        )}
        {newDeptCompany && (
          <NameModal title={`New department — ${newDeptCompany.name}`} placeholder="Department name"
            onClose={() => setNewDeptCompany(null)}
            onSubmit={async (name) => {
              await api.post(`/api/companies/${newDeptCompany.id}/departments`, { name })
              setNewDeptCompany(null); refreshBoards()
            }} showToast={showToast} />
        )}
        {newBoardDept && (
          <NewBoardModal dept={newBoardDept}
            onClose={() => setNewBoardDept(null)}
            onCreated={async (boardId) => {
              setNewBoardDept(null)
              await refreshBoards()
              openBoard(boardId)
            }} showToast={showToast} />
        )}
      </aside>
    </>
  )
}

function NameModal({ title, placeholder, onClose, onSubmit, showToast }) {
  const [name, setName] = useState('')
  return (
    <Modal title={title} onClose={onClose}>
      <form className="form-col" onSubmit={async (e) => {
        e.preventDefault()
        if (!name.trim()) return
        try { await onSubmit(name.trim()) } catch (err) { showToast(err.message) }
      }}>
        <input placeholder={placeholder} value={name} autoFocus
          onChange={e => setName(e.target.value)} required />
        <button className="btn btn-primary">Create</button>
      </form>
    </Modal>
  )
}

function NewBoardModal({ dept, onClose, onCreated, showToast }) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('📋')
  return (
    <Modal title={`New board — ${dept.name}`} onClose={onClose}>
      <form className="form-col" onSubmit={async (e) => {
        e.preventDefault()
        if (!name.trim()) return
        try {
          const data = await api.post(`/api/departments/${dept.id}/boards`, { name: name.trim(), icon })
          onCreated(data.board.id)
        } catch (err) { showToast(err.message) }
      }}>
        <div className="form-row">
          <EmojiPicker value={icon} onChange={setIcon} />
          <input placeholder="Board name" value={name} autoFocus
            onChange={e => setName(e.target.value)} required />
        </div>
        <button className="btn btn-primary">Create board</button>
      </form>
    </Modal>
  )
}
