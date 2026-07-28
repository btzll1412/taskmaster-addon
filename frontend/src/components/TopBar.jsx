import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { Avatar, Popover, Modal, timeAgo, useOutsideClose } from './ui'

export default function TopBar() {
  const { user, unread } = useStore()
  const [showNotif, setShowNotif] = useState(false)
  const [showUser, setShowUser] = useState(false)

  return (
    <header className="topbar">
      <SearchBox />
      <div className="topbar-actions">
        <div className="topbar-anchor">
          <button className={`icon-btn bell ${unread ? 'has-unread' : ''}`} title="Notifications"
            onClick={() => setShowNotif(!showNotif)}>
            🔔{unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
          </button>
          {showNotif && <NotificationsPanel onClose={() => setShowNotif(false)} />}
        </div>
        <ThemeToggle />
        <div className="topbar-anchor">
          <button className="avatar-btn" onClick={() => setShowUser(!showUser)}>
            <Avatar user={user} size={32} />
          </button>
          {showUser && <UserMenu onClose={() => setShowUser(false)} />}
        </div>
      </div>
    </header>
  )
}

function ThemeToggle() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'light')
  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    localStorage.setItem('tm-theme', next)
    setTheme(next)
  }
  return <button className="icon-btn" onClick={toggle} title="Toggle theme">{theme === 'dark' ? '☀️' : '🌙'}</button>
}

function SearchBox() {
  const { openBoard, openItem } = useStore()
  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  const timer = useRef(null)
  const ref = useOutsideClose(() => setResults(null))

  useEffect(() => {
    clearTimeout(timer.current)
    if (q.trim().length < 2) { setResults(null); return }
    timer.current = setTimeout(async () => {
      try { setResults(await api.get(`/api/search?q=${encodeURIComponent(q.trim())}`)) }
      catch { /* ignore */ }
    }, 250)
    return () => clearTimeout(timer.current)
  }, [q])

  return (
    <div className="search-box" ref={ref}>
      <input placeholder="🔍  Search everything…" value={q} onChange={e => setQ(e.target.value)} />
      {results && (results.items.length > 0 || results.boards.length > 0) && (
        <div className="search-results">
          {results.boards.map(b => (
            <button key={`b${b.id}`} className="search-result"
              onClick={() => { openBoard(b.id); setQ(''); setResults(null) }}>
              <span>{b.icon}</span><strong>{b.name}</strong><span className="muted">board</span>
            </button>
          ))}
          {results.items.map(i => (
            <button key={`i${i.id}`} className="search-result"
              onClick={() => { openBoard(i.board_id); openItem(i.id); setQ(''); setResults(null) }}>
              <span>📄</span>{i.name}<span className="muted">{i.board_name}</span>
            </button>
          ))}
        </div>
      )}
      {results && results.items.length === 0 && results.boards.length === 0 && (
        <div className="search-results"><div className="search-empty">No results for “{q.trim()}”</div></div>
      )}
    </div>
  )
}

function NotificationsPanel({ onClose }) {
  const { notifications, unread, refreshNotifications, openBoard, openItem } = useStore()

  async function markAll() {
    await api.post('/api/notifications/read', {})
    refreshNotifications()
  }

  async function clickNotif(n) {
    if (!n.read) { await api.post('/api/notifications/read', { ids: [n.id] }); refreshNotifications() }
    if (n.board_id) { openBoard(n.board_id); if (n.item_id) openItem(n.item_id) }
    onClose()
  }

  return (
    <Popover onClose={onClose} align="right" width={380}>
      <div className="notif-head">
        <strong>Notifications</strong>
        {unread > 0 && <button className="link-btn" onClick={markAll}>Mark all as read</button>}
      </div>
      <div className="notif-list">
        {notifications.length === 0 && <div className="notif-empty">You're all caught up 🎉</div>}
        {notifications.map(n => (
          <button key={n.id} className={`notif-row ${n.read ? '' : 'notif-unread'}`}
            onClick={() => clickNotif(n)}>
            <span className="notif-dot" />
            <span className="notif-msg">{n.message}</span>
            <span className="notif-time">{timeAgo(n.created_at)}</span>
          </button>
        ))}
      </div>
    </Popover>
  )
}

function UserMenu({ onClose }) {
  const { user, logout, navigate, init, showToast } = useStore()
  const [modal, setModal] = useState(null) // 'profile' | 'password'

  return (
    <>
      <Popover onClose={onClose} align="right" width={230}>
        <div className="user-menu-head">
          <Avatar user={user} size={36} />
          <div>
            <div className="user-menu-name">{user.display_name}</div>
            <div className="muted">@{user.username} · {user.role}</div>
          </div>
        </div>
        <button className="menu-item" onClick={() => setModal('profile')}>👤 My profile</button>
        <button className="menu-item" onClick={() => setModal('password')}>🔑 Change password</button>
        {user.role === 'admin' && (
          <button className="menu-item" onClick={() => { navigate({ page: 'admin' }); onClose() }}>
            🛡️ Manage users
          </button>
        )}
        <hr className="menu-sep" />
        <button className="menu-item" onClick={logout}>🚪 Sign out</button>
      </Popover>

      {modal === 'profile' && (
        <ProfileModal user={user} onClose={() => { setModal(null); onClose() }}
          onSaved={async () => { await init(); setModal(null); onClose() }} showToast={showToast} />
      )}
      {modal === 'password' && (
        <PasswordModal onClose={() => { setModal(null); onClose() }} showToast={showToast} />
      )}
    </>
  )
}

function ProfileModal({ user, onClose, onSaved, showToast }) {
  const [displayName, setDisplayName] = useState(user.display_name)
  const [color, setColor] = useState(user.color || '#579bfc')
  const [email, setEmail] = useState(user.email || '')

  async function save(e) {
    e.preventDefault()
    try {
      await api.put('/api/auth/profile', { display_name: displayName, color, email })
      onSaved()
    } catch (err) { showToast(err.message) }
  }

  return (
    <Modal title="My profile" onClose={onClose}>
      <form className="form-col" onSubmit={save}>
        <label>Display name</label>
        <input value={displayName} onChange={e => setDisplayName(e.target.value)} required />
        <label>Email (optional)</label>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} />
        <label>Color</label>
        <input type="color" value={color} onChange={e => setColor(e.target.value)} />
        <button className="btn btn-primary">Save</button>
      </form>
    </Modal>
  )
}

function PasswordModal({ onClose, showToast }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')

  async function save(e) {
    e.preventDefault()
    try {
      await api.post('/api/auth/password', { current_password: current, new_password: next })
      showToast('Password changed')
      onClose()
    } catch (err) { showToast(err.message) }
  }

  return (
    <Modal title="Change password" onClose={onClose}>
      <form className="form-col" onSubmit={save}>
        <label>Current password</label>
        <input type="password" value={current} onChange={e => setCurrent(e.target.value)} required />
        <label>New password (min. 6 characters)</label>
        <input type="password" value={next} onChange={e => setNext(e.target.value)} required minLength={6} />
        <button className="btn btn-primary">Change password</button>
      </form>
    </Modal>
  )
}
