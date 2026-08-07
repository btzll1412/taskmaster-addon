import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { Avatar, Modal, EmojiPicker } from '../components/ui'

const ROLE_LABEL = {
  super_admin: 'Super admin', admin: 'Admin (IT staff)',
  company_admin: 'Company admin', member: 'Member', viewer: 'Viewer',
}

export default function CompanyPage() {
  const { user, route, navigate, openBoard, refreshBoards, showToast } = useStore()
  const [data, setData] = useState(null)
  const [editing, setEditing] = useState(false)
  const [newDept, setNewDept] = useState(false)
  const [newBoard, setNewBoard] = useState(null) // 'direct' | dept object
  const [showUsers, setShowUsers] = useState(false)

  async function load() {
    try { setData(await api.get(`/api/companies/${route.companyId}`)) }
    catch (e) { showToast(e.message); navigate({ page: 'home' }) }
  }
  useEffect(() => { load() }, [route.companyId])

  if (!data) return <div className="muted page-loading">Loading…</div>
  const { company, boards, departments, can_manage, can_create_board } = data
  const cap = (c) => (user.capabilities || []).includes(c)
  // "+ Add job" needs a board we can fully use, or the right to create one
  const canAddJob = cap('create_jobs') &&
    (boards.some(b => b.access === 'full' && !b.archived) || can_create_board)

  async function quickAddJob() {
    try {
      let board = boards.find(b => b.access === 'full' && !b.archived)
      if (!board) {
        const created = await api.post(`/api/companies/${company.id}/boards`, { name: 'Jobs', icon: '🧰' })
        board = created.board
        await refreshBoards()
      }
      navigate({ page: 'board', boardId: board.id, newJob: true })
    } catch (e) { showToast(e.message) }
  }

  const details = [
    ['📍 Address', company.address],
    ['📞 Phone', company.phone],
    ['📱 Phone 2', company.phone2],
    ['✉️ Email', company.email],
    ['👤 Contact', company.contact_name],
    ['📝 Notes', company.notes],
  ].filter(([, v]) => v)

  return (
    <div className="entity-page">
      <div className="entity-head">
        <h2>🏛️ {company.name}</h2>
        <div className="entity-actions">
          {can_manage && <button className="btn btn-secondary" onClick={() => setShowUsers(true)}>👥 Users</button>}
          {can_manage && <button className="btn btn-secondary" onClick={() => setEditing(true)}>✏️ Edit details</button>}
          {can_manage && <button className="btn btn-secondary" onClick={() => setNewDept(true)}>＋ Department</button>}
          {can_create_board && <button className="btn btn-secondary" onClick={() => setNewBoard('direct')}>＋ Job board</button>}
          {canAddJob && <button className="btn btn-primary" onClick={quickAddJob}>＋ Add job</button>}
          {user.role === 'super_admin' && (
            <button className="btn btn-danger" title="Delete this company (departments and boards must be removed first)"
              onClick={async () => {
                if (!confirm(`Delete company "${company.name}"?\n\nIts departments and boards must be deleted first. This is logged in the audit log.`)) return
                try {
                  await api.del(`/api/companies/${company.id}`)
                  await refreshBoards()
                  navigate({ page: 'companies' })
                } catch (e) { showToast(e.message) }
              }}>🗑️ Delete</button>
          )}
        </div>
      </div>

      <div className="detail-card">
        {details.length === 0 && (
          <span className="muted">No company details yet{can_manage ? ' — click "Edit details" to add address, phones, and contacts.' : '.'}</span>
        )}
        {details.map(([label, value]) => (
          <div key={label} className="detail-row">
            <span className="detail-label">{label}</span>
            <span className="detail-value">{value}</span>
          </div>
        ))}
      </div>

      {(boards.some(b => !b.archived) || can_create_board) && (
      <section className="entity-section">
        <h3>🧰 Company jobs <span className="muted">(no department)</span></h3>
        <div className="board-cards">
          {boards.filter(b => !b.archived).map(b => (
            <button key={b.id} className="board-card" onClick={() => openBoard(b.id)}>
              <span className="board-card-icon">{b.icon}</span>
              <span className="board-card-name">{b.name}</span>
              {b.status && <span className="board-status-chip" style={{ background: b.status.color }}>{b.status.label}</span>}
              {b.access === 'partial' && <span className="muted">🔒 limited</span>}
            </button>
          ))}
          {boards.filter(b => !b.archived).length === 0 && (
            <span className="muted">No job boards yet{can_create_board ? ' — use ＋ Job board above.' : '.'}</span>
          )}
        </div>
      </section>
      )}

      {(departments.length > 0 || can_manage) && (
      <section className="entity-section">
        <h3>🏢 Departments</h3>
        <div className="board-cards">
          {departments.map(d => (
            <button key={d.id} className="board-card"
              onClick={() => navigate({ page: 'department', deptId: d.id })}>
              <span className="board-card-icon">{d.icon}</span>
              <span className="board-card-name">{d.name}</span>
              <span className="muted">{d.boards.length} board{d.boards.length === 1 ? '' : 's'}</span>
            </button>
          ))}
          {departments.length === 0 && (
            <span className="muted">No departments{can_manage ? ' yet — use ＋ Department above.' : '.'}</span>
          )}
        </div>
      </section>
      )}

      {showUsers && (
        <CompanyUsersModal company={company} onClose={() => setShowUsers(false)} />
      )}
      {editing && (
        <CompanyDetailsModal company={company} onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); load(); refreshBoards() }} showToast={showToast} />
      )}
      {newDept && (
        <Modal title={`New department — ${company.name}`} onClose={() => setNewDept(false)}>
          <QuickNameForm placeholder="Department name" onSubmit={async (name) => {
            await api.post(`/api/companies/${company.id}/departments`, { name })
            setNewDept(false); load(); refreshBoards()
          }} showToast={showToast} />
        </Modal>
      )}
      {newBoard && (
        <Modal title={`New job board — ${company.name}`} onClose={() => setNewBoard(null)}>
          <NewBoardForm onSubmit={async (name, icon) => {
            const created = await api.post(`/api/companies/${company.id}/boards`, { name, icon })
            setNewBoard(null); await refreshBoards(); openBoard(created.board.id)
          }} showToast={showToast} />
        </Modal>
      )}
    </div>
  )
}

/** All users belonging to this company, with quick add/edit jumps. */
function CompanyUsersModal({ company, onClose }) {
  const { users, navigate } = useStore()
  const companyUsers = users.filter(u => u.company_id === company.id)

  function go(route) {
    onClose()
    navigate(route)
  }

  return (
    <Modal title={`Users — ${company.name}`} onClose={onClose} wide>
      <div className="company-users">
        {companyUsers.length === 0 && (
          <p className="muted">No users in this company yet.</p>
        )}
        {companyUsers.map(u => (
          <div key={u.id} className={`user-row ${u.is_active ? '' : 'user-inactive'}`}>
            <Avatar user={u} size={32} />
            <div className="user-info">
              <strong>{u.display_name}</strong>
              <span className="muted">@{u.username}</span>
            </div>
            {!u.has_password && <span className="pw-warning">⚠️ No password</span>}
            <span className={`role-tag ${u.role}`}>{u.role_name || ROLE_LABEL[u.role] || u.role}</span>
            <button className="btn btn-small"
              onClick={() => go({ page: 'admin', tab: 'users', editUserId: u.id })}>
              ✏️ Edit
            </button>
          </div>
        ))}
        <div className="company-users-foot">
          <button className="btn btn-primary"
            onClick={() => go({ page: 'admin', tab: 'users', newUserCompany: company.id })}>
            ＋ Add user to {company.name}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export function CompanyDetailsModal({ company, onClose, onSaved, showToast }) {
  const [form, setForm] = useState({
    name: company.name, address: company.address || '', phone: company.phone || '',
    phone2: company.phone2 || '', email: company.email || '',
    contact_name: company.contact_name || '', notes: company.notes || '',
  })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  return (
    <Modal title={`Company details — ${company.name}`} onClose={onClose} wide>
      <form className="form-col" onSubmit={async (e) => {
        e.preventDefault()
        try { await api.put(`/api/companies/${company.id}`, form); onSaved() }
        catch (err) { showToast(err.message) }
      }}>
        <label>Company name</label>
        <input value={form.name} onChange={set('name')} required />
        <label>Address</label>
        <textarea rows={2} value={form.address} onChange={set('address')} />
        <div className="form-row">
          <div className="form-col-half">
            <label>Phone</label>
            <input value={form.phone} onChange={set('phone')} />
          </div>
          <div className="form-col-half">
            <label>Phone 2</label>
            <input value={form.phone2} onChange={set('phone2')} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-col-half">
            <label>Email</label>
            <input type="email" value={form.email} onChange={set('email')} />
          </div>
          <div className="form-col-half">
            <label>Contact person</label>
            <input value={form.contact_name} onChange={set('contact_name')} />
          </div>
        </div>
        <label>Notes</label>
        <textarea rows={3} value={form.notes} onChange={set('notes')} />
        <button className="btn btn-primary">Save details</button>
      </form>
    </Modal>
  )
}

export function QuickNameForm({ placeholder, onSubmit, showToast }) {
  const [name, setName] = useState('')
  return (
    <form className="form-col" onSubmit={async (e) => {
      e.preventDefault()
      if (!name.trim()) return
      try { await onSubmit(name.trim()) } catch (err) { showToast(err.message) }
    }}>
      <input placeholder={placeholder} value={name} autoFocus onChange={e => setName(e.target.value)} required />
      <button className="btn btn-primary">Create</button>
    </form>
  )
}

export function NewBoardForm({ onSubmit, showToast }) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('📋')
  return (
    <form className="form-col" onSubmit={async (e) => {
      e.preventDefault()
      if (!name.trim()) return
      try { await onSubmit(name.trim(), icon) } catch (err) { showToast(err.message) }
    }}>
      <div className="form-row">
        <EmojiPicker value={icon} onChange={setIcon} />
        <input placeholder="Board name (e.g. Jobs, Tickets, Projects)" value={name} autoFocus
          onChange={e => setName(e.target.value)} required />
      </div>
      <button className="btn btn-primary">Create board</button>
    </form>
  )
}
