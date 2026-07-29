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
      <PreferencesSection user={user} init={init} showToast={showToast} />
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

function PreferencesSection({ user, init, showToast }) {
  const [busy, setBusy] = useState(false)
  async function toggle(e) {
    setBusy(true)
    try {
      await api.put('/api/auth/profile', { hide_done: e.target.checked })
      await init()
    } catch (err) { showToast(err.message) }
    finally { setBusy(false) }
  }
  return (
    <section className="settings-card">
      <h3>🧹 Preferences</h3>
      <label className="radio-row pref-row">
        <input type="checkbox" checked={!!user.hide_done} disabled={busy} onChange={toggle} />
        <span>Hide <strong>Done</strong> items on boards <span className="muted">(you can always bring them back by unchecking this, or by using the status filter)</span></span>
      </label>
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
  const [data, setData] = useState(null)
  const [name, setName] = useState('')
  const [perms, setPerms] = useState([])
  const isSuper = user.role === 'super_admin'

  const CAP_LABEL = {
    create_jobs: '📝 Create jobs & tasks',
    edit_jobs: '✏️ Edit jobs (status, updates, files)',
    manage_boards: '📋 Manage boards & columns',
    manage_users: '👥 Manage users (own company)',
    manage_access: '🔑 Grant access (own company)',
    manage_company: '🏢 Edit company details & departments',
  }

  async function load() {
    try { setData(await api.get('/api/roles')) }
    catch (e) { showToast(e.message) }
  }
  useEffect(() => { load() }, [])

  function togglePerm(cap) {
    setPerms(p => p.includes(cap) ? p.filter(x => x !== cap) : [...p, cap])
  }

  async function addRole() {
    if (!name.trim()) { showToast('Role name is required'); return }
    try {
      await api.post('/api/roles', { name: name.trim(), permissions: perms })
      setName(''); setPerms([])
      await load()
    } catch (e) { showToast(e.message) }
  }

  return (
    <section className="settings-card">
      <h3>🎭 Roles</h3>
      <p className="muted">
        Universal roles you define here can be assigned to anyone — your IT staff and every company's employees.
        A role is a set of permissions; what people <em>see</em> is still controlled per-user via 🔑 Access.
        A role with no permissions is read-only.
      </p>

      <div className="grants-list">
        {data === null && <div className="muted">Loading…</div>}
        {data?.roles.length === 0 && <div className="muted">No custom roles yet — the built-in levels are always available.</div>}
        {data?.roles.map(r => (
          <div key={r.id} className="grant-row role-row">
            <span className="grant-label">🎭 {r.name}</span>
            <span className="role-caps">
              {r.permissions.length === 0
                ? <span className="chip" style={{ background: '#c4c4c4' }}>read-only</span>
                : r.permissions.map(p => (
                  <span key={p} className="chip cap-chip">{(CAP_LABEL[p] || p).replace(/^[^ ]+ /, '')}</span>
                ))}
            </span>
            {isSuper && (
              <button className="icon-btn" title="Delete role" onClick={async () => {
                if (!confirm(`Delete role "${r.name}"? Users with it become read-only members until reassigned.`)) return
                try { await api.del(`/api/roles/${r.id}`); await load() } catch (e) { showToast(e.message) }
              }}>✕</button>
            )}
          </div>
        ))}
      </div>

      {isSuper && (
        <>
          <h4>New role</h4>
          <div className="form-col role-builder">
            <input placeholder="Role name (e.g. Technician, Dispatcher, Auditor)"
              value={name} onChange={e => setName(e.target.value)} />
            <div className="caps-grid">
              {(data?.capabilities || Object.keys(CAP_LABEL)).map(cap => (
                <label key={cap} className={`cap-option ${perms.includes(cap) ? 'selected' : ''}`}>
                  <input type="checkbox" checked={perms.includes(cap)} onChange={() => togglePerm(cap)} />
                  <span>{CAP_LABEL[cap] || cap}</span>
                </label>
              ))}
            </div>
            <div><button className="btn btn-primary" onClick={addRole}>Add role</button></div>
          </div>
        </>
      )}
    </section>
  )
}
