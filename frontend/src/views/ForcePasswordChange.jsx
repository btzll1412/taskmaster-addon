import React, { useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'

/** The temp password was accepted but there is NO session yet — the user must
 * pick their own password here. Only then does the real session start.
 * Closing the tab simply returns to the login screen. */
export default function ForcePasswordChange() {
  const { pendingUser, init } = useStore()
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
      await api.post('/api/auth/first-password', {
        username: pendingUser.username,
        temp_password: current,
        new_password: next,
      })
      await init()   // session exists only from this point on
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">🔐</div>
        <h1>Welcome, {pendingUser.display_name.split(' ')[0]}!</h1>
        <p className="login-sub">
          Your temporary password checks out.
          Choose your own password to finish signing in.
        </p>
        <input type="password" placeholder="Temporary password" value={current} autoFocus
          autoComplete="current-password"
          onChange={e => setCurrent(e.target.value)} required />
        <input type="password" placeholder="New password (min. 6 characters)" value={next}
          autoComplete="new-password"
          onChange={e => setNext(e.target.value)} required minLength={6} />
        <input type="password" placeholder="Repeat new password" value={confirm}
          autoComplete="new-password"
          onChange={e => setConfirm(e.target.value)} required minLength={6} />
        {error && <div className="form-error">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? '…' : 'Set my password & sign in'}
        </button>
        <button type="button" className="link-btn"
          onClick={() => useStore.setState({ pendingUser: null })}>
          Back to sign in
        </button>
      </form>
    </div>
  )
}
