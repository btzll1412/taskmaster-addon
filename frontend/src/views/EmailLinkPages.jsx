import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'

function clearQuery() {
  window.history.replaceState(null, '', window.location.pathname)
}

/** Opened from a password-reset email: /?reset=TOKEN */
export function ResetPasswordPage({ token }) {
  const { init } = useStore()
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (next.length < 6) { setError('New password must be at least 6 characters'); return }
    if (next !== confirm) { setError('The two passwords do not match'); return }
    setBusy(true)
    try {
      await api.post('/api/auth/reset', { token, new_password: next })
      clearQuery()
      await init()   // signed in with the new password
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">🔐</div>
        <h1>Choose a new password</h1>
        <p className="login-sub">You followed a password-reset link. Set your new password below.</p>
        <input type="password" placeholder="New password (min. 6 characters)" value={next} autoFocus
          autoComplete="new-password" onChange={e => setNext(e.target.value)} required minLength={6} />
        <input type="password" placeholder="Repeat new password" value={confirm}
          autoComplete="new-password" onChange={e => setConfirm(e.target.value)} required minLength={6} />
        {error && <div className="form-error">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? '…' : 'Set password & sign in'}
        </button>
        <button type="button" className="link-btn" onClick={() => { clearQuery(); window.location.reload() }}>
          Back to sign in
        </button>
      </form>
    </div>
  )
}

/** Opened from an invitation email: /?invite=TOKEN */
export function AcceptInvitePage({ token }) {
  const { init } = useStore()
  const [info, setInfo] = useState(null)
  const [invalid, setInvalid] = useState(null)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get(`/api/auth/invite-info?token=${encodeURIComponent(token)}`)
      .then(d => setInfo(d.invite))
      .catch(e => setInvalid(e.message))
  }, [])

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }
    if (password !== confirm) { setError('The two passwords do not match'); return }
    setBusy(true)
    try {
      await api.post('/api/auth/accept-invite', {
        token, username, display_name: displayName, password,
      })
      clearQuery()
      await init()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  if (invalid) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-logo">⏳</div>
          <h1>Invitation expired</h1>
          <p className="login-sub">{invalid}</p>
          <button className="btn btn-primary btn-block"
            onClick={() => { clearQuery(); window.location.reload() }}>Go to sign in</button>
        </div>
      </div>
    )
  }
  if (!info) return <div className="app-loading">Loading…</div>

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">🎉</div>
        <h1>Welcome to TaskMaster!</h1>
        <p className="login-sub">
          You were invited as <strong>{info.email}</strong>
          {info.company_name ? <> at <strong>{info.company_name}</strong></> : null}.
          Set up your account to get started.
        </p>
        <input placeholder="Pick a username" value={username} autoFocus autoComplete="username"
          onChange={e => setUsername(e.target.value)} required />
        <input placeholder="Your name (shown to your team)" value={displayName}
          onChange={e => setDisplayName(e.target.value)} />
        <input type="password" placeholder="Password (min. 6 characters)" value={password}
          autoComplete="new-password" onChange={e => setPassword(e.target.value)} required minLength={6} />
        <input type="password" placeholder="Repeat password" value={confirm}
          autoComplete="new-password" onChange={e => setConfirm(e.target.value)} required minLength={6} />
        {error && <div className="form-error">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? '…' : 'Create my account'}
        </button>
      </form>
    </div>
  )
}
