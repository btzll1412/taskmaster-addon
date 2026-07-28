import React, { useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { Avatar, Modal } from '../components/ui'

export default function AdminUsers() {
  const { user, users, refreshUsers, showToast } = useStore()
  const [showNew, setShowNew] = useState(false)
  const [pwUser, setPwUser] = useState(null)

  if (user.role !== 'admin') return <div className="muted">Admin access required.</div>

  async function toggleRole(u) {
    try {
      await api.put(`/api/users/${u.id}`, { role: u.role === 'admin' ? 'member' : 'admin' })
      refreshUsers()
    } catch (e) { showToast(e.message) }
  }
  async function toggleActive(u) {
    try {
      await api.put(`/api/users/${u.id}`, { is_active: !u.is_active })
      refreshUsers()
    } catch (e) { showToast(e.message) }
  }

  return (
    <div className="admin-view">
      <div className="admin-head">
        <div>
          <h2>Users</h2>
          <p className="muted">Manage who can sign in to this workspace.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>＋ New user</button>
      </div>

      <div className="user-table">
        {users.map(u => (
          <div key={u.id} className={`user-row ${u.is_active ? '' : 'user-inactive'}`}>
            <Avatar user={u} size={34} />
            <div className="user-info">
              <strong>{u.display_name}</strong>
              <span className="muted">@{u.username}</span>
            </div>
            {!u.has_password && <span className="pw-warning" title="This user cannot sign in until a password is set">⚠️ No password</span>}
            <span className={`role-tag ${u.role}`}>{u.role}</span>
            <div className="user-actions">
              <button className="btn btn-small" onClick={() => setPwUser(u)}>Set password</button>
              <button className="btn btn-small" onClick={() => toggleRole(u)} disabled={u.id === user.id}>
                {u.role === 'admin' ? 'Make member' : 'Make admin'}
              </button>
              <button className="btn btn-small" onClick={() => toggleActive(u)} disabled={u.id === user.id}>
                {u.is_active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {showNew && <NewUserModal onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); refreshUsers() }} showToast={showToast} />}
      {pwUser && <SetPasswordModal user={pwUser} onClose={() => setPwUser(null)} showToast={showToast} />}
    </div>
  )
}

function NewUserModal({ onClose, onDone, showToast }) {
  const [form, setForm] = useState({ username: '', display_name: '', password: '', role: 'member', color: '#579bfc' })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function submit(e) {
    e.preventDefault()
    try {
      await api.post('/api/users', form)
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
        <div className="form-row">
          <div className="form-col-half">
            <label>Role</label>
            <select value={form.role} onChange={set('role')}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
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

  async function submit(e) {
    e.preventDefault()
    try {
      await api.post(`/api/users/${user.id}/password`, { password })
      showToast(`Password set for ${user.display_name}`)
      onClose()
    } catch (err) { showToast(err.message) }
  }

  return (
    <Modal title={`Set password — ${user.display_name}`} onClose={onClose}>
      <form className="form-col" onSubmit={submit}>
        <label>New password (min. 6 characters)</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} autoFocus />
        <button className="btn btn-primary">Set password</button>
      </form>
    </Modal>
  )
}
