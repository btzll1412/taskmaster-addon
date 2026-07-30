import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

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

/** Popover rendered in a portal with fixed positioning — overlays everything,
 * never clipped by scroll containers. Anchor via a ref on the trigger element. */
export function OverlayPopover({ anchorRef, onClose, children, width = 230 }) {
  const ref = useRef(null)
  const [style, setStyle] = useState(null)

  useEffect(() => {
    const el = anchorRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let left = r.left + r.width / 2 - width / 2
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
    const spaceBelow = window.innerHeight - r.bottom
    const st = { left, width, position: 'fixed', zIndex: 900 }
    if (spaceBelow < 340 && r.top > 340) {
      st.bottom = window.innerHeight - r.top + 4
    } else {
      st.top = r.bottom + 4
    }
    setStyle(st)
  }, [])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!style) return null
  return createPortal(
    <>
      {/* invisible backdrop: closing the popover swallows the tap instead of
          clicking whatever sits underneath (critical on touch screens) */}
      <div className="popover-overlay-backdrop"
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onClose() }}
        onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); onClose() }} />
      <div ref={ref} className="popover popover-overlay" style={style}
        onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </>,
    document.body,
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
