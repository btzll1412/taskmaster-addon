import React, { useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'

export default function Login() {
  const { setupRequired, init, sessionNotice, branding } = useStore()
  const b = branding || { title: 'TaskMaster', tagline: '', features: [], foot: '', welcome: 'Welcome back', welcome_sub: '' }
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [totp, setTotp] = useState('')
  const [totpNeeded, setTotpNeeded] = useState(false)
  const [forgot, setForgot] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotMsg, setForgotMsg] = useState(null)

  async function sendReset(e) {
    e.preventDefault()
    setForgotMsg(null)
    try {
      const r = await api.post('/api/auth/forgot', { email: forgotEmail })
      setForgotMsg({ ok: true, text: r.message })
    } catch (err) {
      setForgotMsg({ ok: false, text: err.message })
    }
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      if (setupRequired) {
        await api.post('/api/auth/setup', { username, password, display_name: displayName })
      } else {
        const res = await api.post('/api/auth/login', { username, password, totp })
        if (res.totp_required) {
          setTotpNeeded(true)
          setBusy(false)
          return
        }
        if (res.must_change_password) {
          // temp password accepted, but no session yet — go pick a real one
          useStore.setState({ pendingUser: res.user, sessionNotice: null })
          return
        }
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
          <h1 className="auth-title">{b.title}</h1>
          {b.tagline && <p className="auth-tagline">{b.tagline}</p>}
          {b.features.length > 0 && (
            <ul className="auth-features">
              {b.features.map((f, i) => (
                <li key={i}><span className="auth-feat-icon">{f.icon}</span> {f.text}</li>
              ))}
            </ul>
          )}
        </div>
        {b.foot && <div className="auth-brand-foot">{b.foot}</div>}
      </div>

      <div className="auth-form-side">
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-form-logo">✅ <strong>{b.title}</strong></div>
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
              <h2>{b.welcome}</h2>
              {b.welcome_sub && <p className="auth-sub">{b.welcome_sub}</p>}
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
              {totpNeeded && (
                <>
                  <label className="auth-label">2FA code</label>
                  <input placeholder="6-digit code from your authenticator" value={totp} autoFocus
                    maxLength={7} onChange={e => setTotp(e.target.value)} />
                </>
              )}
            </>
          )}
          {error && <div className="form-error">{error}</div>}
          <button className="btn btn-primary btn-block auth-submit" disabled={busy}>
            {busy ? 'Signing in…' : setupRequired ? 'Create admin account' : 'Sign in'}
          </button>
          {setupRequired ? (
            <p className="auth-foot muted">You can add companies, boards and users right after this step.</p>
          ) : !forgot ? (
            <p className="auth-foot muted">
              <button type="button" className="link-btn" onClick={() => setForgot(true)}>
                Forgot your password?
              </button>
            </p>
          ) : (
            <div className="forgot-box">
              <label className="auth-label">Email me a reset link</label>
              <div className="form-row">
                <input type="email" placeholder="you@company.com" value={forgotEmail}
                  onChange={e => setForgotEmail(e.target.value)} style={{ flex: 1 }} />
                <button type="button" className="btn btn-secondary" onClick={sendReset}
                  disabled={!forgotEmail}>Send</button>
              </div>
              {forgotMsg && (
                <div className={forgotMsg.ok ? 'auth-notice' : 'form-error'}>{forgotMsg.text}</div>
              )}
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
