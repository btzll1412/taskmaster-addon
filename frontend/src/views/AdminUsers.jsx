import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { Avatar, Modal, timeAgo } from '../components/ui'

const ROLE_LABEL = {
  super_admin: 'Super admin',
  admin: 'Admin (IT staff)',
  company_admin: 'Company admin',
  member: 'Member',
  viewer: 'Viewer',
}

export default function AdminUsers() {
  const { user } = useStore()
  const isAdmin = ['super_admin', 'admin', 'company_admin'].includes(user.role)

  if (!isAdmin) return <div className="muted">Admin access required.</div>

  return (
    <div className="admin-view">
      <UsersTab />
      <AuditSection />
    </div>
  )
}

/** Deletions and admin actions, permanent record. */
function AuditSection() {
  const { showToast } = useStore()
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)

  async function load() {
    try { setData(await api.get('/api/audit')) }
    catch (e) { showToast(e.message) }
  }

  return (
    <section className="settings-card audit-card">
      <div className="audit-head">
        <h3>📜 Audit log</h3>
        <button className="btn btn-small" onClick={() => {
          const next = !open
          setOpen(next)
          if (next && data === null) load()
        }}>{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && (
        <div className="audit-list">
          {data === null && <div className="muted">Loading…</div>}
          {data?.audit.length === 0 && <div className="muted">No deletions or admin actions recorded yet.</div>}
          {data?.audit.map(a => {
            const actor = data.users[String(a.user_id)]
            return (
              <div key={a.id} className="audit-row">
                <Avatar user={actor} size={24} />
                <span className="audit-text">
                  <strong>{actor?.display_name || 'Someone'}</strong> {a.description}
                </span>
                <span className="muted audit-time">{timeAgo(a.created_at)}</span>
              </div>
            )
          })}
        </div>
      )}
      {!open && <p className="muted">Every deletion (companies, departments, boards, jobs) and every user/access change is recorded here permanently — even after the thing itself is gone.</p>}
    </section>
  )
}

/* ================= Users ================= */

function UsersTab() {
  const { user, users, refreshUsers, workspace, showToast, route } = useStore()
  const [showNew, setShowNew] = useState(!!route.newUserCompany)
  const [pwUser, setPwUser] = useState(null)
  const [grantsUser, setGrantsUser] = useState(null)
  const highlightId = route.editUserId

  useEffect(() => {
    if (highlightId) {
      const el = document.getElementById(`user-row-${highlightId}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [highlightId, users.length])

  const canManage = (u) =>
    user.role === 'super_admin' ||
    (['super_admin', 'admin'].includes(u.role) ? false
      : user.role === 'admin' ? u.company_id != null
        : user.role === 'company_admin' && u.company_id === user.company_id)

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
          <div key={u.id} id={`user-row-${u.id}`}
            className={`user-row ${u.is_active ? '' : 'user-inactive'} ${highlightId === u.id ? 'user-highlight' : ''}`}>
            <Avatar user={u} size={34} />
            <div className="user-info">
              <strong>{u.display_name}</strong>
              <span className="muted">@{u.username}{u.company_name ? ` · ${u.company_name}` : ' · IT staff'}</span>
            </div>
            {!u.has_password && (u.email
              ? <span className="pw-warning" title="Invitation sent — waiting for them to finish setting up">✉️ Invite pending</span>
              : <span className="pw-warning" title="Cannot sign in until a password is set">⚠️ No password</span>)}
            {canManage(u) && u.id !== user.id ? (
              <select className="role-select" value={u.role} onChange={e => setRole(u, e.target.value)}>
                {u.company_id ? (
                  <>
                    <option value="company_admin">Company admin</option>
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </>
                ) : (
                  <>
                    {user.role === 'super_admin' && <option value="super_admin">Super admin</option>}
                    {user.role === 'super_admin' && <option value="admin">Admin (IT staff)</option>}
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </>
                )}
              </select>
            ) : (
              <span className={`role-tag ${u.role}`}>{u.role_name || ROLE_LABEL[u.role] || u.role}</span>
            )}
            {canManage(u) && (
              <div className="user-actions">
                {u.role !== 'super_admin' && (
                  <button className="btn btn-small" onClick={() => setGrantsUser(u)}>🔑 Access</button>
                )}
                {!u.has_password && u.email ? (
                  <button className="btn btn-small" title="Send the invitation email again"
                    onClick={async () => {
                      try { await api.post(`/api/users/${u.id}/invite`); showToast(`Invitation re-sent to ${u.email}`) }
                      catch (e) { showToast(e.message) }
                    }}>✉️ Resend invite</button>
                ) : (
                  <button className="btn btn-small" title="Set a new temporary password — they pick their own on next login"
                    onClick={() => setPwUser(u)}>🔑 Reset password</button>
                )}
                <button className="btn btn-small" onClick={() => toggleActive(u)} disabled={u.id === user.id}>
                  {u.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {showNew && <NewUserModal me={user} workspace={workspace}
        defaultCompanyId={route.newUserCompany}
        onClose={() => setShowNew(false)}
        onDone={() => { setShowNew(false); refreshUsers() }} showToast={showToast} />}
      {pwUser && <SetPasswordModal user={pwUser} onClose={() => setPwUser(null)} showToast={showToast} />}
      {grantsUser && <GrantsModal target={grantsUser} onClose={() => setGrantsUser(null)} showToast={showToast} />}
    </>
  )
}

function NewUserModal({ me, workspace, defaultCompanyId, onClose, onDone, showToast }) {
  const [roles, setRoles] = useState([])
  useEffect(() => { api.get('/api/roles').then(d => setRoles(d.roles)).catch(() => {}) }, [])
  const isSuper = me.role === 'super_admin'
  const [mode, setMode] = useState('invite')  // invite (by email) | manual
  const [form, setForm] = useState({
    username: '', display_name: '', password: '', email: '', color: '#579bfc',
    company_id: me.role === 'company_admin' ? String(me.company_id)
      : defaultCompanyId ? String(defaultCompanyId) : '',
    roleChoice: 'level:member',
    siteMode: 'specific', company_ids: [],
  })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const targetCompany = form.company_id ? Number(form.company_id) : null
  const isStaff = targetCompany === null
  const baseLevels = isStaff
    ? [...(isSuper ? [['super_admin', 'Super admin'], ['admin', 'Admin (IT staff)']] : []),
       ['member', 'Member'], ['viewer', 'Viewer (read-only)']]
    : [['company_admin', 'Company admin'], ['member', 'Member'], ['viewer', 'Viewer (read-only)']]
  const customRoles = roles  // universal - assignable anywhere
  const chosenLevel = form.roleChoice.startsWith('level:')
    ? form.roleChoice.slice(6)
    : roles.find(r => r.id === Number(form.roleChoice.slice(7)))?.level
  const needsSites = isStaff && chosenLevel !== 'super_admin'

  function toggleSite(id) {
    setForm(f => ({ ...f, company_ids: f.company_ids.includes(id)
      ? f.company_ids.filter(x => x !== id) : [...f.company_ids, id] }))
  }

  async function submit(e) {
    e.preventDefault()
    const payload = { company_id: targetCompany }
    if (mode === 'invite') {
      payload.email = form.email
    } else {
      payload.username = form.username
      payload.display_name = form.display_name
      payload.password = form.password
      payload.color = form.color
    }
    if (form.roleChoice.startsWith('custom:')) payload.custom_role_id = Number(form.roleChoice.slice(7))
    else payload.role = form.roleChoice.slice(6)
    if (needsSites) {
      if (form.siteMode === 'all') payload.all_companies = true
      else payload.company_ids = form.company_ids
    }
    try {
      await api.post(mode === 'invite' ? '/api/users/invite' : '/api/users', payload)
      if (mode === 'invite') showToast(`Invitation sent to ${form.email}`)
      onDone()
    } catch (err) { showToast(err.message) }
  }

  return (
    <Modal title="Add user" onClose={onClose} wide>
      <form className="form-col" onSubmit={submit}>
        <div className="view-tabs new-user-tabs">
          <button type="button" className={mode === 'invite' ? 'active' : ''}
            onClick={() => setMode('invite')}>✉️ Invite by email</button>
          <button type="button" className={mode === 'manual' ? 'active' : ''}
            onClick={() => setMode('manual')}>✍️ Create manually</button>
        </div>

        {mode === 'invite' ? (
          <>
            <label>Email address</label>
            <input type="email" placeholder="person@customer.com" value={form.email}
              onChange={set('email')} required autoFocus />
            <p className="muted invite-hint">
              They'll get an email with a link to pick their own username, display name and
              password — nothing for you to hand over. The link lasts 7 days.
            </p>
          </>
        ) : (
          <>
            <div className="form-row">
              <div className="form-col-half">
                <label>Username</label>
                <input value={form.username} onChange={set('username')} required autoFocus />
              </div>
              <div className="form-col-half">
                <label>Display name</label>
                <input value={form.display_name} onChange={set('display_name')} />
              </div>
            </div>
            <label>Temporary password <span className="muted">(min. 6 — they must pick their own on first login)</span></label>
            <input type="password" value={form.password} onChange={set('password')} required minLength={6} />
          </>
        )}

        {me.role !== 'company_admin' && (
          <>
            <label>Belongs to</label>
            <select value={form.company_id}
              onChange={e => setForm({ ...form, company_id: e.target.value, roleChoice: 'level:member', company_ids: [] })}>
              {isSuper && <option value="">🛠️ IT staff (your own team)</option>}
              {workspace.companies.map(c => <option key={c.id} value={c.id}>🏛️ {c.name}</option>)}
            </select>
          </>
        )}

        <div className="form-row">
          <div className="form-col-half">
            <label>Role</label>
            <select value={form.roleChoice} onChange={set('roleChoice')}>
              {baseLevels.map(([v, l]) => <option key={v} value={'level:' + v}>{l}</option>)}
              {customRoles.length > 0 && <option disabled>── custom roles ──</option>}
              {customRoles.map(r => <option key={r.id} value={'custom:' + r.id}>🎭 {r.name}</option>)}
            </select>
          </div>
          <div className="form-col-half">
            <label>Color</label>
            <input type="color" value={form.color} onChange={set('color')} />
          </div>
        </div>

        {needsSites && (
          <div className="sites-box">
            <label>Which companies (sites) can they access?</label>
            <div className="form-row">
              {isSuper && (
                <label className="radio-row">
                  <input type="radio" checked={form.siteMode === 'all'}
                    onChange={() => setForm({ ...form, siteMode: 'all' })} /> 🌐 All companies
                </label>
              )}
              <label className="radio-row">
                <input type="radio" checked={form.siteMode === 'specific'}
                  onChange={() => setForm({ ...form, siteMode: 'specific' })} /> Specific companies
              </label>
            </div>
            {form.siteMode === 'specific' && (
              <SitePicker companies={workspace.companies}
                selected={form.company_ids} onToggle={toggleSite} />
            )}
            <p className="muted sites-hint">You can fine-tune down to departments, boards, or single jobs later via 🔑 Access.</p>
          </div>
        )}

        <button className="btn btn-primary">
          {mode === 'invite' ? '✉️ Send invitation' : 'Create user'}
        </button>
      </form>
    </Modal>
  )
}

function SetPasswordModal({ user, onClose, showToast }) {
  const [password, setPassword] = useState('')
  return (
    <Modal title={`Reset password — ${user.display_name}`} onClose={onClose}>
      <form className="form-col" onSubmit={async (e) => {
        e.preventDefault()
        try {
          await api.post(`/api/users/${user.id}/password`, { password })
          showToast(`Password set for ${user.display_name}`)
          onClose()
        } catch (err) { showToast(err.message) }
      }}>
        <label>Temporary password <span className="muted">(min. 6 — they must pick their own on next login)</span></label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} autoFocus />
        <button className="btn btn-primary">Set temporary password</button>
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
  const [editing, setEditing] = useState(null) // grant being edited, or null

  async function load() {
    try { setGrants((await api.get(`/api/users/${target.id}/grants`)).grants) }
    catch (e) { showToast(e.message) }
  }
  useEffect(() => { load() }, [target.id])

  const company = workspace.companies.find(c => c.id === Number(companyId))
  const departments = company?.departments || []
  const dept = departments.find(d => d.id === Number(deptId))
  const boards = deptId === 'direct' ? (company?.boards || []) : (dept?.boards || [])

  function clearForm() {
    setCompanyId(''); setDeptId(''); setBoardId(''); setEditing(null)
  }

  /** Locate a grant's scope inside the workspace tree to prefill the pickers. */
  function startEdit(g) {
    setEditing(g)
    if (g.scope_type === 'company') {
      setScopeType('company'); setCompanyId(String(g.scope_id)); setDeptId(''); setBoardId('')
      return
    }
    if (g.scope_type === 'department') {
      for (const c of workspace.companies) {
        if (c.departments.some(d => d.id === g.scope_id)) {
          setScopeType('department'); setCompanyId(String(c.id)); setDeptId(String(g.scope_id)); setBoardId('')
          return
        }
      }
    }
    if (g.scope_type === 'board') {
      for (const c of workspace.companies) {
        if ((c.boards || []).some(b => b.id === g.scope_id)) {
          setScopeType('board'); setCompanyId(String(c.id)); setDeptId('direct'); setBoardId(String(g.scope_id))
          return
        }
        for (const d of c.departments) {
          if (d.boards.some(b => b.id === g.scope_id)) {
            setScopeType('board'); setCompanyId(String(c.id)); setDeptId(String(d.id)); setBoardId(String(g.scope_id))
            return
          }
        }
      }
    }
    showToast('That access target no longer exists — remove the rule instead')
    setEditing(null)
  }

  async function saveGrant() {
    let scope_id = null
    if (scopeType === 'company') scope_id = Number(companyId)
    if (scopeType === 'department') scope_id = Number(deptId)
    if (scopeType === 'board') scope_id = Number(boardId)
    if (!scope_id) { showToast('Pick what to grant access to'); return }
    try {
      if (editing) {
        await api.put(`/api/grants/${editing.id}`, { scope_type: scopeType, scope_id })
      } else {
        await api.post(`/api/users/${target.id}/grants`, { scope_type: scopeType, scope_id })
      }
      clearForm()
      await load()
    } catch (e) { showToast(e.message) }
  }

  async function removeGrant(g) {
    try {
      await api.del(`/api/grants/${g.id}`)
      if (editing?.id === g.id) clearForm()
      await load()
    } catch (e) { showToast(e.message) }
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
            <div key={g.id} className={`grant-row ${editing?.id === g.id ? 'grant-editing' : ''}`}>
              <span className="grant-label">{g.label}</span>
              <span className="grant-type">{g.scope_type}</span>
              {['company', 'department', 'board'].includes(g.scope_type) && (
                <button className="btn btn-small" title="Change this access rule"
                  onClick={() => startEdit(g)}>✏️ Edit</button>
              )}
              <button className="icon-btn" title="Remove access" onClick={() => removeGrant(g)}>✕</button>
            </div>
          ))}
        </div>

        <h4>{editing ? `✏️ Editing rule: ${editing.label}` : 'Grant new access'}</h4>
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
              {scopeType === 'board' && <option value="direct">— Company jobs (no department) —</option>}
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          {scopeType === 'board' && (
            <select value={boardId} onChange={e => setBoardId(e.target.value)} disabled={!deptId}>
              <option value="">Board…</option>
              {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <button className="btn btn-primary btn-small" onClick={saveGrant}>
            {editing ? 'Save changes' : 'Grant'}
          </button>
          {editing && (
            <button className="btn btn-small" onClick={clearForm}>Cancel</button>
          )}
        </div>
        <p className="muted grant-hint">💡 To share a <strong>single job</strong>, open that job on its board and use “Share access”.</p>
      </div>
    </Modal>
  )
}

/** Big searchable multi-select for company (site) access. */
function SitePicker({ companies, selected, onToggle }) {
  const [q, setQ] = useState('')
  const filtered = companies.filter(c =>
    !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()))
  const selectedCompanies = companies.filter(c => selected.includes(c.id))

  return (
    <div className="site-picker">
      <input className="site-search" placeholder="🔍 Search sites…"
        value={q} onChange={e => setQ(e.target.value)} />
      <div className="site-list">
        {filtered.map(c => (
          <label key={c.id} className={`site-option ${selected.includes(c.id) ? 'selected' : ''}`}>
            <input type="checkbox" checked={selected.includes(c.id)} onChange={() => onToggle(c.id)} />
            <span className="site-option-name">🏛️ {c.name}</span>
            {selected.includes(c.id) && <span className="check">✓</span>}
          </label>
        ))}
        {filtered.length === 0 && <div className="muted popover-hint">No sites match "{q}"</div>}
      </div>
      {selectedCompanies.length > 0 && (
        <div className="chip-row site-chips">
          {selectedCompanies.map(c => (
            <span key={c.id} className="chip site-chip">
              {c.name}
              <button type="button" className="chip-x" onClick={() => onToggle(c.id)}>✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
