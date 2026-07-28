import React, { useEffect, useRef, useState } from 'react'

export function useOutsideClose(onClose) {
  const ref = useRef(null)
  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])
  return ref
}

/** Small anchored popover. Renders children inside an absolutely-positioned card. */
export function Popover({ onClose, children, align = 'left', width }) {
  const ref = useOutsideClose(onClose)
  return (
    <div ref={ref} className={`popover popover-${align}`} style={width ? { width } : undefined}
      onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  )
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal-card ${wide ? 'modal-wide' : ''}`}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function Avatar({ user, size = 28 }) {
  if (!user) return null
  return (
    <span className="avatar" title={user.display_name}
      style={{ width: size, height: size, fontSize: size * 0.4, background: user.color || '#579bfc' }}>
      {user.initials || '?'}
    </span>
  )
}

export function AvatarStack({ users, size = 26, max = 3 }) {
  const shown = users.slice(0, max)
  const extra = users.length - shown.length
  return (
    <span className="avatar-stack">
      {shown.map(u => <Avatar key={u.id} user={u} size={size} />)}
      {extra > 0 && <span className="avatar avatar-extra" style={{ width: size, height: size, fontSize: size * 0.38 }}>+{extra}</span>}
    </span>
  )
}

export function Spinner() {
  return <div className="spinner" />
}

const EMOJIS = ['📋', '🏠', '🚀', '🎯', '💼', '🛠️', '🌱', '🎨', '📦', '💡', '🔥', '⭐', '🏗️', '🧹', '🛒', '📚', '💰', '🚗', '✈️', '🍽️', '🎉', '🏥', '🖥️', '📷']

export function EmojiPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="emoji-picker">
      <button type="button" className="emoji-current" onClick={() => setOpen(!open)}>{value || '📋'}</button>
      {open && (
        <Popover onClose={() => setOpen(false)}>
          <div className="emoji-grid">
            {EMOJIS.map(e => (
              <button key={e} type="button" className="emoji-option"
                onClick={() => { onChange(e); setOpen(false) }}>{e}</button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  )
}

// ---- date helpers ----

export function fmtDate(isoDate) {
  if (!isoDate) return ''
  const d = new Date(isoDate + 'T00:00:00')
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })
}

export function fmtDateTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function timeAgo(iso) {
  if (!iso) return ''
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`
  return new Date(iso).toLocaleDateString()
}

export function dueClass(isoDate, doneish) {
  if (!isoDate || doneish) return ''
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(isoDate + 'T00:00:00')
  if (d < today) return 'overdue'
  if (d.getTime() === today.getTime()) return 'due-today'
  return ''
}
