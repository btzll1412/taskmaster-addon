import React, { useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'

/** First login with a temporary password: the user must pick their own
 * password before anything else loads. The server blocks the rest of the
 * API until this succeeds. */
export default function ForcePasswordChange() {
  const { user, init, logout } = useStore()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (next.length < 6) { setError('New password must be at least 6 characters'); return }
    if (next === current) { setError('Your new password must be different from the temporary one'); return }
    if (next !== confirm) { setError('The two passwords do not match'); return }
    setBusy(true)
    try {
      await api.post('/api/auth/password', { current_password: current, new_password: next })
      await init()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">🔐</div>
        <h1>Welcome, {user.display_name.split(' ')[0]}!</h1>
        <p className="login-sub">
          You signed in with a temporary password.
          Choose your own password to start using TaskMaster.
        </p>
        <input type="password" placeholder="Temporary password" value={current} autoFocus
          onChange={e => setCurrent(e.target.value)} required />
        <input type="password" placeholder="New password (min. 6 characters)" value={next}
          onChange={e => setNext(e.target.value)} required minLength={6} />
        <input type="password" placeholder="Repeat new password" value={confirm}
          onChange={e => setConfirm(e.target.value)} required minLength={6} />
        {error && <div className="form-error">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? '…' : 'Set my password'}
        </button>
        <button type="button" className="link-btn" onClick={logout}>Sign out</button>
      </form>
    </div>
  )
}
