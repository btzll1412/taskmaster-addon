import React, { useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { Modal, EmojiPicker, hideDoneBoard } from './ui'

function usePersistedSet(key) {
  const [set, setSet] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')) } catch { return new Set() }
  })
  function toggle(id) {
    const next = new Set(set)
    next.has(id) ? next.delete(id) : next.add(id)
    setSet(next)
    localStorage.setItem(key, JSON.stringify([...next]))
  }
  return [set, toggle]
}

export default function Sidebar() {
  const { user, workspace, route, navigate, refreshBoards, openBoard, showToast,
    sidebarMobile, toggleSidebarMobile } = useStore()
  const [newBoardDept, setNewBoardDept] = useState(null)
  const [newDeptCompany, setNewDeptCompany] = useState(null)
  const [showRequest, setShowRequest] = useState(false)
  const [closedCompanies, toggleCompany] = usePersistedSet('tm-closed-companies')
  const [closedDepts, toggleDept] = usePersistedSet('tm-closed-depts')
  const [companiesOpen, setCompaniesOpen] = useState(localStorage.getItem('tm-companies-open') !== '0')
  function toggleCompaniesSection() {
    const next = !companiesOpen
    setCompaniesOpen(next)
    localStorage.setItem('tm-companies-open', next ? '1' : '0')
  }
  const [collapsed, setCollapsed] = useState(localStorage.getItem('tm-sidebar-collapsed') === '1')
  function toggleCollapsed() {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('tm-sidebar-collapsed', next ? '1' : '0')
  }

  return (
    <>
      {sidebarMobile && <div className="sidebar-backdrop" onClick={toggleSidebarMobile} />}
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${sidebarMobile ? 'mobile-open' : ''}`}>
        <div className="sidebar-brand">
          <span className="brand-icon">✅</span>
          <span className="brand-name">TaskMaster</span>
          <button className="sidebar-toggle" onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? '»' : '«'}
          </button>
        </div>

        <nav className="sidebar-nav">
          <button className={`nav-item ${route.page === 'home' ? 'active' : ''}`} title="Home"
            onClick={() => navigate({ page: 'home' })}>
            <span className="nav-icon">🏡</span><span className="nav-label">Home</span>
          </button>
          <button className={`nav-item ${route.page === 'mywork' ? 'active' : ''}`} title="My Work"
            onClick={() => navigate({ page: 'mywork' })}>
            <span className="nav-icon">🗂️</span><span className="nav-label">My Work</span>
          </button>
          {user.company_id && !(user.capabilities || []).includes('create_jobs') && (
            <button className="nav-item" title="New request"
              onClick={() => setShowRequest(true)}>
              <span className="nav-icon">📨</span><span className="nav-label">New request</span>
            </button>
          )}
          <div className={`nav-item companies-nav ${route.page === 'companies' ? 'active' : ''}`} title="Companies"
            onClick={collapsed ? () => navigate({ page: 'companies' }) : undefined}>
            <span className="nav-icon">🏛️</span>
            <span className="companies-nav-label nav-label" onClick={() => navigate({ page: 'companies' })}>Companies</span>
            <button className="tree-chevron companies-chevron" onClick={toggleCompaniesSection}>
              {companiesOpen ? '▾' : '▸'}
            </button>
          </div>
        </nav>

        <div className="sidebar-section">
          {companiesOpen && workspace.companies.map(c => (
            <div key={c.id} className="tree-company">
              <div className="tree-row tree-company-row">
                <button className="tree-chevron" onClick={() => toggleCompany(c.id)}>
                  {closedCompanies.has(c.id) ? '▸' : '▾'}
                </button>
                <span className="tree-label company-label" title={c.name}
                  onClick={() => navigate({ page: 'company', companyId: c.id })}>🏛️ {c.name}</span>
              </div>

              {!closedCompanies.has(c.id) && (c.boards || []).filter(b => !b.archived && !hideDoneBoard(user, b)).map(b => (
                <div key={'b' + b.id} className="tree-dept">
                  <BoardNode board={b}
                    active={route.page === 'board' && route.boardId === b.id}
                    onOpen={() => openBoard(b.id)} showToast={showToast} />
                </div>
              ))}
              {!closedCompanies.has(c.id) && c.departments.map(d => (
                <div key={d.id} className="tree-dept">
                  <div className="tree-row tree-dept-row">
                    <button className="tree-chevron" onClick={() => toggleDept(d.id)}>
                      {closedDepts.has(d.id) ? '▸' : '▾'}
                    </button>
                    <span className="tree-label" title={d.name}
                      onClick={() => navigate({ page: 'department', deptId: d.id })}>{d.icon} {d.name}</span>
                    {d.can_create_board && (
                      <button className="icon-btn tree-add" title="New board"
                        onClick={() => setNewBoardDept(d)}>＋</button>
                    )}
                  </div>
                  {!closedDepts.has(d.id) && d.boards.filter(b => !b.archived && !hideDoneBoard(user, b)).map(b => (
                    <BoardNode key={b.id} board={b}
                      active={route.page === 'board' && route.boardId === b.id}
                      onOpen={() => openBoard(b.id)} showToast={showToast} />
                  ))}
                  {!closedDepts.has(d.id) && d.boards.filter(b => !b.archived).length === 0 && (
                    <div className="tree-empty muted">no boards</div>
                  )}
                </div>
              ))}
            </div>
          ))}

          {companiesOpen && workspace.companies.length === 0 && (
            <div className="sidebar-empty">
              {workspace.can_create_companies
                ? 'No companies yet — add one from the Companies page.'
                : 'Nothing shared with you yet.'}
            </div>
          )}
        </div>

        <div className="sidebar-bottom">
          {(user.capabilities || []).includes('create_jobs') && (
            <button className={`nav-item ${route.page === 'templates' ? 'active' : ''}`} title="Templates"
              onClick={() => navigate({ page: 'templates' })}>
              <span className="nav-icon">📦</span><span className="nav-label">Templates</span>
            </button>
          )}
          {['super_admin', 'admin', 'company_admin'].includes(user.role) && (
            <button className={`nav-item ${route.page === 'admin' ? 'active' : ''}`} title="Users"
              onClick={() => navigate({ page: 'admin', tab: 'users' })}>
              <span className="nav-icon">👥</span><span className="nav-label">Users</span>
            </button>
          )}
          <button className={`nav-item ${route.page === 'settings' ? 'active' : ''}`} title="Settings"
            onClick={() => navigate({ page: 'settings' })}>
            <span className="nav-icon">⚙️</span><span className="nav-label">Settings</span>
          </button>
        </div>

        {newDeptCompany && (
          <NameModal title={`New department — ${newDeptCompany.name}`} placeholder="Department name"
            onClose={() => setNewDeptCompany(null)}
            onSubmit={async (name) => {
              await api.post(`/api/companies/${newDeptCompany.id}/departments`, { name })
              setNewDeptCompany(null); refreshBoards()
            }} showToast={showToast} />
        )}
        {showRequest && (
          <RequestModal onClose={() => setShowRequest(false)} showToast={showToast} />
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

/** Board leaf that can expand one level deeper to list its jobs. */
function BoardNode({ board, active, onOpen, showToast }) {
  const { openBoard, openItem, panelItemId } = useStore()
  const [expanded, setExpanded] = useState(false)
  const [jobs, setJobs] = useState(null)

  async function toggle(e) {
    e.stopPropagation()
    if (expanded) { setExpanded(false); return }
    setExpanded(true)
    try {
      setJobs((await api.get(`/api/boards/${board.id}/items`)).items)
    } catch (err) { showToast(err.message); setExpanded(false) }
  }

  return (
    <div className="tree-board">
      <div className={`tree-row tree-board-row ${active ? 'active' : ''}`} onClick={onOpen} title={board.name}>
        <button className="tree-chevron" onClick={toggle}>{expanded ? '▾' : '▸'}</button>
        <span className="tree-label">
          <span className="nav-icon">{board.icon}</span>{board.name}
        </span>
        {board.access === 'partial'
          ? <span className="board-count" title="You can see specific jobs only">🔒</span>
          : board.items_count > 0 && <span className="board-count">{board.items_count}</span>}
      </div>
      {expanded && (
        <div className="tree-jobs">
          {jobs === null && <div className="tree-empty muted">loading…</div>}
          {jobs?.length === 0 && <div className="tree-empty muted">no jobs yet</div>}
          {jobs?.map(j => (
            <button key={j.id}
              className={`tree-row tree-job-row ${active && panelItemId === j.id ? 'active' : ''}`}
              title={j.name}
              onClick={() => { openBoard(board.id); openItem(j.id) }}>
              <span className="job-dot" style={{ background: j.color || 'var(--border)' }} />
              <span className="tree-label">{j.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Simple help-request intake for company users who can't create jobs. */
function RequestModal({ onClose, showToast }) {
  const [subject, setSubject] = useState('')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="📨 New request" onClose={onClose}>
      <form className="form-col" onSubmit={async (e) => {
        e.preventDefault()
        if (!subject.trim() || busy) return
        setBusy(true)
        try {
          await api.post('/api/requests', { subject: subject.trim(), details: details.trim() })
          showToast('Request sent — the team has been notified ✅')
          onClose()
        } catch (err) {
          showToast(err.message)
          setBusy(false)
        }
      }}>
        <label>What do you need?</label>
        <input placeholder="e.g. Printer in reception not working" value={subject} autoFocus
          onChange={e => setSubject(e.target.value)} required />
        <label>Details <span className="muted">(optional)</span></label>
        <textarea rows={4} placeholder="Anything that helps us fix it faster…"
          value={details} onChange={e => setDetails(e.target.value)} />
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
      </form>
    </Modal>
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
