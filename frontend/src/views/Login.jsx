import React, { useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'

export default function Login() {
  const { setupRequired, init } = useStore()
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      if (setupRequired) {
        await api.post('/api/auth/setup', { username, password, display_name: displayName })
      } else {
        await api.post('/api/auth/login', { username, password })
      }
      await init()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">✅</div>
        <h1>TaskMaster</h1>
        {setupRequired ? (
          <>
            <p className="login-sub">Welcome! Create your admin account to get started.</p>
            <input placeholder="Username" value={username} autoFocus
              onChange={e => setUsername(e.target.value)} required />
            <input placeholder="Display name" value={displayName}
              onChange={e => setDisplayName(e.target.value)} />
            <input type="password" placeholder="Password (min. 6 characters)" value={password}
              onChange={e => setPassword(e.target.value)} required minLength={6} />
          </>
        ) : (
          <>
            <p className="login-sub">Sign in to your workspace</p>
            <input placeholder="Username" value={username} autoFocus
              onChange={e => setUsername(e.target.value)} required />
            <input type="password" placeholder="Password" value={password}
              onChange={e => setPassword(e.target.value)} required />
          </>
        )}
        {error && <div className="form-error">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? '…' : setupRequired ? 'Create admin account' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
