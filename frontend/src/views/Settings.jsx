import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'

const LEVEL_LABEL = {
  super_admin: 'Super admin', admin: 'Admin (IT staff)',
  company_admin: 'Company admin', member: 'Member', viewer: 'Viewer (read-only)',
}

export default function Settings() {
  const { user, init, showToast, workspace } = useStore()
  const canRoles = ['super_admin', 'admin', 'company_admin'].includes(user.role)

  return (
    <div className="entity-page settings-page">
      <div className="entity-head"><h2>⚙️ Settings</h2></div>

      <ProfileSection user={user} init={init} showToast={showToast} />
      <PasswordSection showToast={showToast} />
      <AppearanceSection />
      {canRoles && <RolesSection user={user} workspace={workspace} showToast={showToast} />}
    </div>
  )
}

function ProfileSection({ user, init, showToast }) {
  const [form, setForm] = useState({
    display_name: user.display_name, color: user.color || '#579bfc', email: user.email || '',
  })
  return (
    <section className="settings-card">
      <h3>👤 My profile</h3>
      <form className="form-col" onSubmit={async (e) => {
        e.preventDefault()
        try {
          await api.put('/api/auth/profile', form)
          await init()
          showToast('Profile saved')
        } catch (err) { showToast(err.message) }
      }}>
        <div className="form-row">
          <div className="form-col-half">
            <label>Display name</label>
            <input value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })} required />
          </div>
          <div className="form-col-half">
            <label>Email</label>
            <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
        </div>
        <label>My color</label>
        <input type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} />
        <div><button className="btn btn-primary">Save profile</button></div>
      </form>
    </section>
  )
}

function PasswordSection({ showToast }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  return (
    <section className="settings-card">
      <h3>🔑 Change password</h3>
      <form className="form-col" onSubmit={async (e) => {
        e.preventDefault()
        try {
          await api.post('/api/auth/password', { current_password: current, new_password: next })
          setCurrent(''); setNext('')
          showToast('Password changed')
        } catch (err) { showToast(err.message) }
      }}>
        <div className="form-row">
          <div className="form-col-half">
            <label>Current password</label>
            <input type="password" value={current} onChange={e => setCurrent(e.target.value)} required />
          </div>
          <div className="form-col-half">
            <label>New password (min. 6)</label>
            <input type="password" value={next} onChange={e => setNext(e.target.value)} required minLength={6} />
          </div>
        </div>
        <div><button className="btn btn-primary">Change password</button></div>
      </form>
    </section>
  )
}

function AppearanceSection() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'light')
  function pick(t) {
    document.documentElement.dataset.theme = t
    localStorage.setItem('tm-theme', t)
    setTheme(t)
  }
  return (
    <section className="settings-card">
      <h3>🎨 Appearance</h3>
      <div className="form-row">
        <button className={`btn ${theme === 'light' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => pick('light')}>☀️ Light</button>
        <button className={`btn ${theme === 'dark' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => pick('dark')}>🌙 Dark</button>
      </div>
    </section>
  )
}

function RolesSection({ user, workspace, showToast }) {
  const [roles, setRoles] = useState(null)
  const [name, setName] = useState('')
  const [level, setLevel] = useState('member')
  const [companyId, setCompanyId] = useState(user.role === 'company_admin' ? String(user.company_id) : '')
  const isSuper = user.role === 'super_admin'

  async function load() {
    try { setRoles((await api.get('/api/roles')).roles) }
    catch (e) { showToast(e.message) }
  }
  useEffect(() => { load() }, [])

  const companyName = (id) => workspace.companies.find(c => c.id === id)?.name || '?'
  const staffLevels = ['admin', 'member', 'viewer']
  const companyLevels = ['company_admin', 'member', 'viewer']
  const levels = companyId ? companyLevels : staffLevels

  async function addRole() {
    if (!name.trim()) { showToast('Role name is required'); return }
    try {
      await api.post('/api/roles', {
        name: name.trim(), level,
        company_id: companyId ? Number(companyId) : null,
      })
      setName('')
      await load()
    } catch (e) { showToast(e.message) }
  }

  return (
    <section className="settings-card">
      <h3>🎭 Roles</h3>
      <p className="muted">Define named roles to assign when creating users. Each role maps to a permission level:
        {' '}<strong>Admin</strong> manages the companies they're given, <strong>Company admin</strong> runs their own company,
        {' '}<strong>Member</strong> edits what they can see, <strong>Viewer</strong> is read-only.</p>

      <div className="grants-list">
        {roles === null && <div className="muted">Loading…</div>}
        {roles?.length === 0 && <div className="muted">No custom roles yet — the built-in levels are always available.</div>}
        {roles?.map(r => (
          <div key={r.id} className="grant-row">
            <span className="grant-label">🎭 {r.name}</span>
            <span className="muted">{r.company_id ? companyName(r.company_id) : 'IT staff'}</span>
            <span className="grant-type">{LEVEL_LABEL[r.level] || r.level}</span>
            <button className="icon-btn" title="Delete role" onClick={async () => {
              if (!confirm(`Delete role "${r.name}"? Users keep their permissions but lose the label.`)) return
              try { await api.del(`/api/roles/${r.id}`); await load() } catch (e) { showToast(e.message) }
            }}>✕</button>
          </div>
        ))}
      </div>

      <h4>New role</h4>
      <div className="grant-form">
        <input placeholder="Role name (e.g. Technician)" value={name} onChange={e => setName(e.target.value)} />
        {isSuper ? (
          <select value={companyId} onChange={e => { setCompanyId(e.target.value); setLevel('member') }}>
            <option value="">For: IT staff</option>
            {workspace.companies.map(c => <option key={c.id} value={c.id}>For: {c.name}</option>)}
          </select>
        ) : (
          <span className="muted">for {user.role === 'company_admin' ? 'your company' : 'your companies'}</span>
        )}
        <select value={level} onChange={e => setLevel(e.target.value)}>
          {levels.map(l => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
        </select>
        <button className="btn btn-primary btn-small" onClick={addRole}>Add role</button>
      </div>
    </section>
  )
}
