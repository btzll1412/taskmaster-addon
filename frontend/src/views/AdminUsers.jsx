import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { Avatar, Modal } from '../components/ui'

const ROLE_LABEL = {
  super_admin: 'Super admin',
  company_admin: 'Company admin',
  member: 'Member',
}

export default function AdminUsers() {
  const { user, route } = useStore()
  const [tab, setTab] = useState(
    route.tab === 'companies' && user.role === 'super_admin' ? 'companies' : 'users')
  const isAdmin = user.role === 'super_admin' || user.role === 'company_admin'

  if (!isAdmin) return <div className="muted">Admin access required.</div>

  return (
    <div className="admin-view">
      <div className="view-tabs admin-tabs">
        <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>👥 Users & access</button>
        {user.role === 'super_admin' && (
          <button className={tab === 'companies' ? 'active' : ''} onClick={() => setTab('companies')}>🏛 Companies</button>
        )}
      </div>
      {tab === 'users' ? <UsersTab /> : <CompaniesTab />}
    </div>
  )
}

/* ================= Users ================= */

function UsersTab() {
  const { user, users, refreshUsers, workspace, showToast } = useStore()
  const [showNew, setShowNew] = useState(false)
  const [pwUser, setPwUser] = useState(null)
  const [grantsUser, setGrantsUser] = useState(null)

  const canManage = (u) =>
    user.role === 'super_admin' ||
    (user.role === 'company_admin' && u.company_id === user.company_id && u.role !== 'super_admin')

  async function toggleActive(u) {
    try {
      await api.put(`/api/users/${u.id}`, { is_active: !u.is_active })
      refreshUsers()
    } catch (e) { showToast(e.message) }
  }

  async function setRole(u, role) {
    try {
      await api.put(`/api/users/${u.id}`, { role })
      refreshUsers()
    } catch (e) { showToast(e.message) }
  }

  return (
    <>
      <div className="admin-head">
        <div>
          <h2>Users</h2>
          <p className="muted">Each person sees only what you grant them — a whole company, a department, a board, or single jobs.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>＋ New user</button>
      </div>

      <div className="user-table">
        {users.map(u => (
          <div key={u.id} className={`user-row ${u.is_active ? '' : 'user-inactive'}`}>
            <Avatar user={u} size={34} />
            <div className="user-info">
              <strong>{u.display_name}</strong>
              <span className="muted">@{u.username}{u.company_name ? ` · ${u.company_name}` : ' · IT staff'}</span>
            </div>
            {!u.has_password && <span className="pw-warning" title="Cannot sign in until a password is set">⚠️ No password</span>}
            {canManage(u) && u.id !== user.id ? (
              <select className="role-select" value={u.role} onChange={e => setRole(u, e.target.value)}>
                <option value="member">Member</option>
                <option value="company_admin">Company admin</option>
                {user.role === 'super_admin' && <option value="super_admin">Super admin</option>}
              </select>
            ) : (
              <span className={`role-tag ${u.role}`}>{ROLE_LABEL[u.role] || u.role}</span>
            )}
            {canManage(u) && (
              <div className="user-actions">
                {u.role !== 'super_admin' && (
                  <button className="btn btn-small" onClick={() => setGrantsUser(u)}>🔑 Access</button>
                )}
                <button className="btn btn-small" onClick={() => setPwUser(u)}>Password</button>
                <button className="btn btn-small" onClick={() => toggleActive(u)} disabled={u.id === user.id}>
                  {u.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {showNew && <NewUserModal me={user} workspace={workspace}
        onClose={() => setShowNew(false)}
        onDone={() => { setShowNew(false); refreshUsers() }} showToast={showToast} />}
      {pwUser && <SetPasswordModal user={pwUser} onClose={() => setPwUser(null)} showToast={showToast} />}
      {grantsUser && <GrantsModal target={grantsUser} onClose={() => setGrantsUser(null)} showToast={showToast} />}
    </>
  )
}

function NewUserModal({ me, workspace, onClose, onDone, showToast }) {
  const [form, setForm] = useState({
    username: '', display_name: '', password: '', role: 'member',
    color: '#579bfc', company_id: '',
  })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function submit(e) {
    e.preventDefault()
    try {
      await api.post('/api/users', {
        ...form,
        company_id: form.company_id ? Number(form.company_id) : null,
      })
      onDone()
    } catch (err) { showToast(err.message) }
  }

  return (
    <Modal title="Create user" onClose={onClose}>
      <form className="form-col" onSubmit={submit}>
        <label>Username</label>
        <input value={form.username} onChange={set('username')} required autoFocus />
        <label>Display name</label>
        <input value={form.display_name} onChange={set('display_name')} />
        <label>Password (min. 6 characters — leave empty to set later)</label>
        <input type="password" value={form.password} onChange={set('password')} minLength={form.password ? 6 : undefined} />
        {me.role === 'super_admin' && (
          <>
            <label>Company (empty = your own IT staff)</label>
            <select value={form.company_id} onChange={set('company_id')}>
              <option value="">— IT staff (no company) —</option>
              {workspace.companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </>
        )}
        <div className="form-row">
          <div className="form-col-half">
            <label>Role</label>
            <select value={form.role} onChange={set('role')}>
              <option value="member">Member</option>
              <option value="company_admin">Company admin</option>
              {me.role === 'super_admin' && <option value="super_admin">Super admin</option>}
            </select>
          </div>
          <div className="form-col-half">
            <label>Color</label>
            <input type="color" value={form.color} onChange={set('color')} />
          </div>
        </div>
        <button className="btn btn-primary">Create user</button>
      </form>
    </Modal>
  )
}

function SetPasswordModal({ user, onClose, showToast }) {
  const [password, setPassword] = useState('')
  return (
    <Modal title={`Set password — ${user.display_name}`} onClose={onClose}>
      <form className="form-col" onSubmit={async (e) => {
        e.preventDefault()
        try {
          await api.post(`/api/users/${user.id}/password`, { password })
          showToast(`Password set for ${user.display_name}`)
          onClose()
        } catch (err) { showToast(err.message) }
      }}>
        <label>New password (min. 6 characters)</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} autoFocus />
        <button className="btn btn-primary">Set password</button>
      </form>
    </Modal>
  )
}

/* ---- Access grants ---- */

function GrantsModal({ target, onClose, showToast }) {
  const { workspace } = useStore()
  const [grants, setGrants] = useState(null)
  const [scopeType, setScopeType] = useState('department')
  const [companyId, setCompanyId] = useState('')
  const [deptId, setDeptId] = useState('')
  const [boardId, setBoardId] = useState('')

  async function load() {
    try { setGrants((await api.get(`/api/users/${target.id}/grants`)).grants) }
    catch (e) { showToast(e.message) }
  }
  useEffect(() => { load() }, [target.id])

  const company = workspace.companies.find(c => c.id === Number(companyId))
  const departments = company?.departments || []
  const dept = departments.find(d => d.id === Number(deptId))
  const boards = dept?.boards || []

  async function addGrant() {
    let scope_id = null
    if (scopeType === 'company') scope_id = Number(companyId)
    if (scopeType === 'department') scope_id = Number(deptId)
    if (scopeType === 'board') scope_id = Number(boardId)
    if (!scope_id) { showToast('Pick what to grant access to'); return }
    try {
      await api.post(`/api/users/${target.id}/grants`, { scope_type: scopeType, scope_id })
      await load()
    } catch (e) { showToast(e.message) }
  }

  async function removeGrant(g) {
    try { await api.del(`/api/grants/${g.id}`); await load() }
    catch (e) { showToast(e.message) }
  }

  return (
    <Modal title={`Access — ${target.display_name}`} onClose={onClose} wide>
      <div className="grants-modal">
        <p className="muted">
          {target.role === 'company_admin'
            ? 'Company admins automatically see everything in their own company. Grants below add access beyond that.'
            : 'This user sees only what is listed here (plus jobs they are assigned to).'}
        </p>

        <div className="grants-list">
          {grants === null && <div className="muted">Loading…</div>}
          {grants?.length === 0 && <div className="muted">No access granted yet.</div>}
          {grants?.map(g => (
            <div key={g.id} className="grant-row">
              <span className="grant-label">{g.label}</span>
              <span className="grant-type">{g.scope_type}</span>
              <button className="icon-btn" title="Remove access" onClick={() => removeGrant(g)}>✕</button>
            </div>
          ))}
        </div>

        <h4>Grant new access</h4>
        <div className="grant-form">
          <select value={scopeType} onChange={e => setScopeType(e.target.value)}>
            <option value="company">Entire company</option>
            <option value="department">Department</option>
            <option value="board">Single board</option>
          </select>
          <select value={companyId} onChange={e => { setCompanyId(e.target.value); setDeptId(''); setBoardId('') }}>
            <option value="">Company…</option>
            {workspace.companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {scopeType !== 'company' && (
            <select value={deptId} onChange={e => { setDeptId(e.target.value); setBoardId('') }} disabled={!companyId}>
              <option value="">Department…</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          {scopeType === 'board' && (
            <select value={boardId} onChange={e => setBoardId(e.target.value)} disabled={!deptId}>
              <option value="">Board…</option>
              {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <button className="btn btn-primary btn-small" onClick={addGrant}>Grant</button>
        </div>
        <p className="muted grant-hint">💡 To share a <strong>single job</strong>, open that job on its board and use “Share access”.</p>
      </div>
    </Modal>
  )
}

/* ================= Companies ================= */

function CompaniesTab() {
  const { workspace, refreshBoards, showToast } = useStore()
  const [newDeptFor, setNewDeptFor] = useState(null)
  const [name, setName] = useState('')

  async function addCompany(e) {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await api.post('/api/companies', { name: name.trim() })
      setName(''); refreshBoards()
    } catch (err) { showToast(err.message) }
  }

  async function removeCompany(c) {
    if (!confirm(`Delete company "${c.name}"? (Departments must be removed first)`)) return
    try { await api.del(`/api/companies/${c.id}`); refreshBoards() }
    catch (e) { showToast(e.message) }
  }

  async function removeDept(d) {
    if (!confirm(`Delete department "${d.name}"? (Boards must be removed first)`)) return
    try { await api.del(`/api/departments/${d.id}`); refreshBoards() }
    catch (e) { showToast(e.message) }
  }

  return (
    <>
      <div className="admin-head">
        <div>
          <h2>Companies & departments</h2>
          <p className="muted">One company per customer. Departments hold their boards.</p>
        </div>
        <form className="form-row" onSubmit={addCompany}>
          <input placeholder="New company name" value={name} onChange={e => setName(e.target.value)} />
          <button className="btn btn-primary">＋ Add</button>
        </form>
      </div>

      <div className="company-cards">
        {workspace.companies.map(c => (
          <div key={c.id} className="company-card">
            <div className="company-card-head">
              <strong>🏛 {c.name}</strong>
              <div>
                <button className="btn btn-small" onClick={() => setNewDeptFor(c)}>＋ Department</button>
                <button className="icon-btn" title="Delete company" onClick={() => removeCompany(c)}>🗑️</button>
              </div>
            </div>
            <div className="dept-chips">
              {c.departments.map(d => (
                <span key={d.id} className="dept-chip">
                  {d.icon} {d.name}
                  <span className="muted"> · {d.boards.length} board{d.boards.length === 1 ? '' : 's'}</span>
                  <button className="chip-x" onClick={() => removeDept(d)}>✕</button>
                </span>
              ))}
              {c.departments.length === 0 && <span className="muted">No departments yet.</span>}
            </div>
          </div>
        ))}
      </div>

      {newDeptFor && (
        <Modal title={`New department — ${newDeptFor.name}`} onClose={() => setNewDeptFor(null)}>
          <NewDeptForm company={newDeptFor} onDone={() => { setNewDeptFor(null); refreshBoards() }} showToast={showToast} />
        </Modal>
      )}
    </>
  )
}

function NewDeptForm({ company, onDone, showToast }) {
  const [name, setName] = useState('')
  return (
    <form className="form-col" onSubmit={async (e) => {
      e.preventDefault()
      if (!name.trim()) return
      try {
        await api.post(`/api/companies/${company.id}/departments`, { name: name.trim() })
        onDone()
      } catch (err) { showToast(err.message) }
    }}>
      <input placeholder="Department name" value={name} autoFocus onChange={e => setName(e.target.value)} required />
      <button className="btn btn-primary">Create department</button>
    </form>
  )
}
