import React, { useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'

export default function Login() {
  const { setupRequired, init, sessionNotice } = useStore()
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
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
    <div className="auth-page">
      <div className="auth-brand">
        <div className="auth-brand-inner">
          <div className="auth-logo"><span>✅</span></div>
          <h1 className="auth-title">TaskMaster</h1>
          <p className="auth-tagline">Jobs, boards and teams — one portal for you and your customers.</p>
          <ul className="auth-features">
            <li><span className="auth-feat-icon">📋</span> Track every job and sub-task, live</li>
            <li><span className="auth-feat-icon">🔔</span> Automatic notifications on status changes</li>
          </ul>
        </div>
        <div className="auth-brand-foot">Runs locally on your own server</div>
      </div>

      <div className="auth-form-side">
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-form-logo">✅ <strong>TaskMaster</strong></div>
          {sessionNotice && <div className="auth-notice">⏳ {sessionNotice}</div>}
          {setupRequired ? (
            <>
              <h2>Set up your workspace</h2>
              <p className="auth-sub">Create the administrator account to get started.</p>
              <label className="auth-label">Username</label>
              <input value={username} autoFocus autoComplete="username"
                onChange={e => setUsername(e.target.value)} required />
              <label className="auth-label">Display name</label>
              <input value={displayName} placeholder="Shown to your team"
                onChange={e => setDisplayName(e.target.value)} />
              <label className="auth-label">Password</label>
              <div className="auth-pw-wrap">
                <input type={showPw ? 'text' : 'password'} value={password} minLength={6} required
                  autoComplete="new-password" placeholder="Minimum 6 characters"
                  onChange={e => setPassword(e.target.value)} />
                <button type="button" className="auth-pw-toggle" tabIndex={-1}
                  onClick={() => setShowPw(!showPw)}>{showPw ? '🙈' : '👁️'}</button>
              </div>
            </>
          ) : (
            <>
              <h2>Welcome back</h2>
              <p className="auth-sub">Sign in to your workspace</p>
              <label className="auth-label">Username</label>
              <input value={username} autoFocus autoComplete="username"
                onChange={e => setUsername(e.target.value)} required />
              <label className="auth-label">Password</label>
              <div className="auth-pw-wrap">
                <input type={showPw ? 'text' : 'password'} value={password} required
                  autoComplete="current-password"
                  onChange={e => setPassword(e.target.value)} />
                <button type="button" className="auth-pw-toggle" tabIndex={-1}
                  title={showPw ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPw(!showPw)}>{showPw ? '🙈' : '👁️'}</button>
              </div>
            </>
          )}
          {error && <div className="form-error">{error}</div>}
          <button className="btn btn-primary btn-block auth-submit" disabled={busy}>
            {busy ? 'Signing in…' : setupRequired ? 'Create admin account' : 'Sign in'}
          </button>
          <p className="auth-foot muted">
            {setupRequired
              ? 'You can add companies, boards and users right after this step.'
              : 'Forgot your password? Ask your administrator for a reset.'}
          </p>
        </form>
      </div>
    </div>
  )
}
