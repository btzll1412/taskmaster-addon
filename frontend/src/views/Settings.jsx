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
  const isAdmin = canRoles
  const [tab, setTab] = useState('general')

  return (
    <div className="entity-page settings-page">
      <div className="entity-head"><h2>⚙️ Settings</h2></div>

      {isAdmin && (
        <div className="view-tabs settings-tabs">
          <button className={tab === 'general' ? 'active' : ''} onClick={() => setTab('general')}>
            <span className="tab-icon">🧑</span> General
          </button>
          <button className={tab === 'automations' ? 'active' : ''} onClick={() => setTab('automations')}>
            <span className="tab-icon">⚡</span> Automations
          </button>
          <button className={tab === 'roles' ? 'active' : ''} onClick={() => setTab('roles')}>
            <span className="tab-icon">🎭</span> Roles
          </button>
          {user.role === 'super_admin' && (
            <button className={tab === 'login' ? 'active' : ''} onClick={() => setTab('login')}>
              <span className="tab-icon">🖥️</span> Login screen
            </button>
          )}
          {user.role === 'super_admin' && (
            <button className={tab === 'email' ? 'active' : ''} onClick={() => setTab('email')}>
              <span className="tab-icon">✉️</span> Email
            </button>
          )}
        </div>
      )}

      {tab === 'general' && (
        <>
          <ProfileSection user={user} init={init} showToast={showToast} />
          <PreferencesSection user={user} init={init} showToast={showToast} />
          <PasswordSection showToast={showToast} />
          <AppearanceSection />
        </>
      )}
      {tab === 'automations' && isAdmin && <AutomationsSection user={user} showToast={showToast} />}
      {tab === 'roles' && canRoles && <RolesSection user={user} workspace={workspace} showToast={showToast} />}
      {tab === 'login' && user.role === 'super_admin' && <LoginScreenSection showToast={showToast} />}
      {tab === 'email' && user.role === 'super_admin' && <EmailSection user={user} showToast={showToast} />}
    </div>
  )
}

function EmailSection({ user, showToast }) {
  const [s, setS] = useState(null)
  const [saving, setSaving] = useState(false)
  const [testTo, setTestTo] = useState(user.email || '')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  useEffect(() => {
    api.get('/api/email-settings').then(d => setS(d.settings)).catch(e => showToast(e.message))
  }, [])

  if (!s) return <section className="settings-card"><div className="muted">Loading…</div></section>
  const set = (k) => (e) => setS({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  async function save() {
    setSaving(true)
    try {
      const d = await api.put('/api/email-settings', s)
      setS(d.settings)
      showToast('Email settings saved')
    } catch (e) { showToast(e.message) }
    finally { setSaving(false) }
  }

  async function sendTest() {
    setTesting(true); setTestResult(null)
    try {
      // save first so the test uses what's on screen
      await api.put('/api/email-settings', s)
      await api.post('/api/email-settings/test', { to: testTo })
      setTestResult({ ok: true, msg: `Test email sent to ${testTo} — check the inbox.` })
    } catch (e) {
      setTestResult({ ok: false, msg: e.message })
    } finally { setTesting(false) }
  }

  return (
    <section className="settings-card">
      <h3>✉️ Email service</h3>
      <p className="muted">
        Connect your SMTP server (e.g. your provider's outgoing mail, Gmail with an app
        password, or SendGrid) and TaskMaster emails people their notifications —
        assignments, status changes, and mentions. People without an email address, or who
        switch it off in their preferences, are simply skipped.
      </p>
      <div className="form-col">
        <label className="radio-row">
          <input type="checkbox" checked={!!s.enabled} onChange={set('enabled')} />
          <span><strong>Send notification emails</strong></span>
        </label>
        <div className="form-row">
          <div className="form-col-half">
            <label>SMTP server</label>
            <input placeholder="e.g. smtp.gmail.com" value={s.host} onChange={set('host')} />
          </div>
          <div className="form-col-half">
            <label>Port</label>
            <input type="number" value={s.port} onChange={set('port')} />
          </div>
        </div>
        <label>Security</label>
        <select value={s.security} onChange={set('security')}>
          <option value="starttls">STARTTLS (usual, port 587)</option>
          <option value="ssl">SSL/TLS (port 465)</option>
          <option value="none">None (local relay)</option>
        </select>
        <div className="form-row">
          <div className="form-col-half">
            <label>Username <span className="muted">(empty = no login)</span></label>
            <input value={s.username} onChange={set('username')} autoComplete="off" />
          </div>
          <div className="form-col-half">
            <label>Password {s.has_password && <span className="muted">(saved — leave empty to keep)</span>}</label>
            <input type="password" placeholder={s.has_password ? '••••••••' : ''}
              value={s.password || ''} onChange={set('password')} autoComplete="new-password" />
          </div>
        </div>
        <div className="form-row">
          <div className="form-col-half">
            <label>From name</label>
            <input value={s.from_name} onChange={set('from_name')} />
          </div>
          <div className="form-col-half">
            <label>From address</label>
            <input type="email" placeholder="taskmaster@yourcompany.com" value={s.from_addr} onChange={set('from_addr')} />
          </div>
        </div>
        <label>Portal address <span className="muted">(optional — adds an "Open TaskMaster" link to every email)</span></label>
        <input placeholder="https://tasks.yourcompany.com" value={s.base_url} onChange={set('base_url')} />
        <div><button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save email settings'}
        </button></div>

        <h4>Send a test</h4>
        <div className="form-row">
          <input type="email" placeholder="you@yourcompany.com" value={testTo}
            onChange={e => setTestTo(e.target.value)} style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={sendTest} disabled={testing || !testTo}>
            {testing ? 'Sending…' : '✉️ Send test email'}
          </button>
        </div>
        {testResult && (
          <div className={testResult.ok ? 'auth-notice email-test-ok' : 'form-error'}>
            {testResult.ok ? '✅ ' : ''}{testResult.msg}
          </div>
        )}
      </div>
    </section>
  )
}

function LoginScreenSection({ showToast }) {
  const [b, setB] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get('/api/auth/branding').then(d => setB(d.branding)).catch(e => showToast(e.message))
  }, [])

  if (!b) return <section className="settings-card"><div className="muted">Loading…</div></section>
  const set = (k) => (e) => setB({ ...b, [k]: e.target.value })
  const setFeature = (i, k, v) =>
    setB({ ...b, features: b.features.map((f, j) => j === i ? { ...f, [k]: v } : f) })

  function move(i, dir) {
    const j = i + dir
    if (j < 0 || j >= b.features.length) return
    const next = [...b.features]
    ;[next[i], next[j]] = [next[j], next[i]]
    setB({ ...b, features: next })
  }

  async function save() {
    setSaving(true)
    try {
      const d = await api.put('/api/auth/branding', b)
      setB(d.branding)
      useStore.setState({ branding: d.branding })
      showToast('Login screen saved — sign out to see it')
    } catch (e) { showToast(e.message) }
    finally { setSaving(false) }
  }

  return (
    <section className="settings-card">
      <h3>🖥️ Login screen</h3>
      <p className="muted">
        Everything written on the sign-in page is yours to change. Empty fields are simply hidden.
      </p>
      <div className="form-col">
        <div className="form-row">
          <div className="form-col-half">
            <label>Title</label>
            <input value={b.title} onChange={set('title')} maxLength={60} />
          </div>
          <div className="form-col-half">
            <label>Bottom line (left panel)</label>
            <input value={b.foot} onChange={set('foot')} maxLength={120} />
          </div>
        </div>
        <label>Tagline</label>
        <textarea rows={2} value={b.tagline} onChange={set('tagline')} />

        <label>Feature lines <span className="muted">(up to 8 — icon + text, reorder with ↑↓)</span></label>
        <div className="template-subs">
          {b.features.map((f, i) => (
            <div key={i} className="template-sub-row">
              <input className="branding-icon-input" value={f.icon} maxLength={4}
                onChange={e => setFeature(i, 'icon', e.target.value)} title="Icon (emoji)" />
              <input value={f.text} placeholder="Feature text"
                onChange={e => setFeature(i, 'text', e.target.value)} />
              <button type="button" className="icon-btn" title="Move up" disabled={i === 0}
                onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="icon-btn" title="Move down" disabled={i === b.features.length - 1}
                onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="icon-btn" title="Remove line"
                onClick={() => setB({ ...b, features: b.features.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          {b.features.length < 8 && (
            <div>
              <button type="button" className="btn btn-small"
                onClick={() => setB({ ...b, features: [...b.features, { icon: '⭐', text: '' }] })}>
                ＋ Add line
              </button>
            </div>
          )}
        </div>

        <div className="form-row">
          <div className="form-col-half">
            <label>Sign-in heading</label>
            <input value={b.welcome} onChange={set('welcome')} maxLength={80} />
          </div>
          <div className="form-col-half">
            <label>Sign-in sub-heading</label>
            <input value={b.welcome_sub} onChange={set('welcome_sub')} maxLength={120} />
          </div>
        </div>

        <div><button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save login screen'}
        </button></div>
      </div>
    </section>
  )
}

function AutomationsSection({ user, showToast }) {
  const { users, workspace } = useStore()
  const [data, setData] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const isSuper = user.role === 'super_admin'
  const myCompanyIds = user.role === 'company_admin'
    ? [user.company_id]
    : workspace.companies.map(c => c.id)

  async function load() {
    try { setData(await api.get('/api/automations')) }
    catch (e) { showToast(e.message) }
  }
  useEffect(() => { load() }, [])

  // is this rule ON for the viewer's world?
  function isOn(r) {
    if (!r.enabled) return false
    if (r.company_id === null && !isSuper) {
      return !r.disabled_company_ids.includes(user.company_id ?? myCompanyIds[0])
    }
    return true
  }

  async function toggle(r) {
    try {
      await api.put(`/api/automations/${r.id}`, { enabled: !isOn(r) })
      await load()
    } catch (e) { showToast(e.message) }
  }

  return (
    <section className="settings-card">
      <h3>⚡ Automations</h3>
      <p className="muted">
        Notify people automatically when a job's status changes — on every board.
        {isSuper
          ? ' Rules without a company apply to all companies; each company admin can still switch them off for their own company.'
          : ' Global rules come from the system admin — you can switch them on or off for your company. Your own rules apply to your company only.'}
      </p>

      <div className="grants-list">
        {data === null && <div className="muted">Loading…</div>}
        {data?.automations.length === 0 && <div className="muted">No automations yet.</div>}
        {data?.automations.map(r => (
          <div key={r.id} className={`grant-row automation-row ${isOn(r) ? '' : 'automation-off'}`}>
            <label className="switch" title={isOn(r) ? 'On — click to turn off' : 'Off — click to turn on'}>
              <input type="checkbox" checked={isOn(r)} onChange={() => toggle(r)} />
              <span className="switch-slider" />
            </label>
            <div className="automation-main">
              <strong>{r.name || 'Automation'}</strong>
              <span className="muted">
                When status becomes {r.label_text ? `"${r.label_text}"` : 'anything'} → notify{' '}
                {[
                  ...r.notify_user_ids.map(id => data.users[String(id)]?.display_name || '?'),
                  ...(r.notify_assignees ? ['people assigned to the job'] : []),
                ].join(', ') || 'nobody'}
              </span>
            </div>
            <span className={`role-tag ${r.company_id === null ? 'super_admin' : 'member'}`}>
              {r.company_id === null ? '🌐 All companies' : data.company_names[String(r.company_id)] || 'Company'}
            </span>
            {(isSuper || (r.company_id !== null && myCompanyIds.includes(r.company_id))) && (
              <button className="icon-btn" title="Delete automation" onClick={async () => {
                if (!confirm(`Delete automation "${r.name}"?`)) return
                try { await api.del(`/api/automations/${r.id}`); await load() } catch (e) { showToast(e.message) }
              }}>🗑️</button>
            )}
          </div>
        ))}
      </div>

      {!showNew && <div><button className="btn btn-primary" onClick={() => setShowNew(true)}>＋ New automation</button></div>}
      {showNew && (
        <NewAutomationForm user={user} users={users} workspace={workspace} isSuper={isSuper}
          onDone={() => { setShowNew(false); load() }} showToast={showToast} />
      )}
    </section>
  )
}

function NewAutomationForm({ user, users, workspace, isSuper, onDone, showToast }) {
  const [name, setName] = useState('')
  const [label, setLabel] = useState('Done')
  const [companyId, setCompanyId] = useState(isSuper ? '' : String(user.company_id || ''))
  const [notifyAssignees, setNotifyAssignees] = useState(true)
  const [userIds, setUserIds] = useState([])
  const LABELS = ['Done', 'Working on it', 'Stuck', 'Not Started']

  function toggleUser(id) {
    setUserIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])
  }

  async function save() {
    try {
      await api.post('/api/automations', {
        name: name.trim(),
        label_text: label === '__any__' ? '' : label,
        company_id: companyId ? Number(companyId) : null,
        notify_user_ids: userIds,
        notify_assignees: notifyAssignees,
      })
      onDone()
    } catch (e) { showToast(e.message) }
  }

  return (
    <div className="form-col automation-form">
      <h4>New automation</h4>
      <input placeholder="Name (e.g. Tell the office when a job is done)" value={name}
        onChange={e => setName(e.target.value)} />
      <div className="form-row">
        <div className="form-col-half">
          <label>When status becomes</label>
          <select value={label} onChange={e => setLabel(e.target.value)}>
            {LABELS.map(l => <option key={l} value={l}>{l}</option>)}
            <option value="__any__">Any change</option>
          </select>
        </div>
        {isSuper && (
          <div className="form-col-half">
            <label>Applies to</label>
            <select value={companyId} onChange={e => setCompanyId(e.target.value)}>
              <option value="">🌐 All companies</option>
              {workspace.companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
      </div>
      <label className="radio-row">
        <input type="checkbox" checked={notifyAssignees} onChange={e => setNotifyAssignees(e.target.checked)} />
        <span>Notify the people assigned to the job</span>
      </label>
      <label>Also notify these people</label>
      <div className="sites-grid">
        {users.filter(u => u.is_active).map(u => (
          <label key={u.id} className={`cap-option ${userIds.includes(u.id) ? 'selected' : ''}`}>
            <input type="checkbox" checked={userIds.includes(u.id)} onChange={() => toggleUser(u.id)} />
            <span>{u.display_name}</span>
          </label>
        ))}
      </div>
      <div className="form-row">
        <button className="btn btn-primary" onClick={save}>Create automation</button>
        <button className="btn btn-secondary" onClick={onDone}>Cancel</button>
      </div>
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
  const toggle = (field) => async (e) => {
    setBusy(true)
    try {
      await api.put('/api/auth/profile', { [field]: e.target.checked })
      await init()
    } catch (err) { showToast(err.message) }
    finally { setBusy(false) }
  }
  return (
    <section className="settings-card">
      <h3>🧹 Preferences</h3>
      <label className="radio-row pref-row">
        <input type="checkbox" checked={!!user.hide_done} disabled={busy} onChange={toggle('hide_done')} />
        <span>Hide <strong>Done</strong> items on boards <span className="muted">(you can always bring them back by unchecking this, or by using the status filter)</span></span>
      </label>
      <label className="radio-row pref-row">
        <input type="checkbox" checked={!!user.email_notifications} disabled={busy} onChange={toggle('email_notifications')} />
        <span>Email me my notifications <span className="muted">(assignments, status changes, mentions — needs an email on your profile)</span></span>
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
