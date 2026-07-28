import React, { useRef, useState } from 'react'
import { Avatar, AvatarStack, OverlayPopover, fmtDate, dueClass } from './ui'

const LABEL_COLORS = ['#00c875', '#fdab3d', '#e2445c', '#579bfc', '#a25ddc', '#66ccff', '#ff642e', '#c4c4c4', '#333333', '#ff158a', '#037f4c', '#cab641']

/**
 * Renders + edits a single column value.
 * value formats: status/priority {id} · text {text} · number {number} · date {date}
 * people {user_ids:[]} · dropdown {ids:[]} · checkbox {checked}
 */
export default function Cell({ column, value, users, onChange, onUpdateColumn, compact }) {
  const [editing, setEditing] = useState(false)
  const t = column.type

  if (t === 'status' || t === 'priority') {
    return <StatusCell column={column} value={value} onChange={onChange}
      onUpdateColumn={onUpdateColumn} editing={editing} setEditing={setEditing} />
  }
  if (t === 'people') {
    return <PeopleCell value={value} users={users} onChange={onChange}
      editing={editing} setEditing={setEditing} compact={compact} />
  }
  if (t === 'date') {
    return <DateCell value={value} onChange={onChange} editing={editing} setEditing={setEditing} />
  }
  if (t === 'text') {
    return <TextCell value={value} onChange={onChange} editing={editing} setEditing={setEditing} />
  }
  if (t === 'number') {
    return <NumberCell column={column} value={value} onChange={onChange} editing={editing} setEditing={setEditing} />
  }
  if (t === 'dropdown') {
    return <DropdownCell column={column} value={value} onChange={onChange}
      onUpdateColumn={onUpdateColumn} editing={editing} setEditing={setEditing} />
  }
  if (t === 'checkbox') {
    const checked = !!(value && value.checked)
    return (
      <div className="cell cell-checkbox" onClick={() => onChange(checked ? null : { checked: true })}>
        <span className={`checkbox ${checked ? 'checked' : ''}`}>{checked ? '✓' : ''}</span>
      </div>
    )
  }
  return <div className="cell" />
}

function StatusCell({ column, value, onChange, onUpdateColumn, editing, setEditing }) {
  const labels = column.settings?.labels || []
  const current = labels.find(l => l.id === value?.id)
  const [managing, setManaging] = useState(false)
  const anchor = useRef(null)
  return (
    <div ref={anchor} className="cell cell-status" style={{ background: current?.color || 'var(--cell-empty)' }}
      onClick={() => setEditing(true)}>
      <span className={current ? 'status-text' : 'status-placeholder'}>{current?.label || ''}</span>
      {editing && (
        <OverlayPopover anchorRef={anchor} onClose={() => { setEditing(false); setManaging(false) }} width={230}>
          {!managing ? (
            <>
              <div className="label-list">
                {labels.map(l => (
                  <button key={l.id} className="label-option" style={{ background: l.color }}
                    onClick={() => { onChange({ id: l.id }); setEditing(false) }}>
                    {l.label}
                  </button>
                ))}
                <button className="label-option label-clear" onClick={() => { onChange(null); setEditing(false) }}>
                  Clear
                </button>
              </div>
              {onUpdateColumn && (
                <button className="link-btn label-edit-toggle" onClick={() => setManaging(true)}>✏️ Edit labels</button>
              )}
            </>
          ) : (
            <LabelEditor labels={labels}
              onSave={(next) => { onUpdateColumn({ ...column.settings, labels: next }); setManaging(false) }}
              onCancel={() => setManaging(false)} />
          )}
        </OverlayPopover>
      )}
    </div>
  )
}

function LabelEditor({ labels, onSave, onCancel }) {
  const [rows, setRows] = useState(labels.map(l => ({ ...l })))
  function update(i, patch) {
    setRows(rows.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  }
  function add() {
    setRows([...rows, {
      id: `l${Date.now().toString(36)}`,
      label: 'New label',
      color: LABEL_COLORS[rows.length % LABEL_COLORS.length],
    }])
  }
  return (
    <div className="label-editor">
      {rows.map((r, i) => (
        <div key={r.id} className="label-editor-row">
          <input type="color" value={r.color} onChange={e => update(i, { color: e.target.value })} />
          <input value={r.label} onChange={e => update(i, { label: e.target.value })} />
          <button className="icon-btn" title="Remove"
            onClick={() => setRows(rows.filter((_, idx) => idx !== i))}>✕</button>
        </div>
      ))}
      <button className="link-btn" onClick={add}>＋ Add label</button>
      <div className="label-editor-actions">
        <button className="btn btn-small" onClick={onCancel}>Cancel</button>
        <button className="btn btn-small btn-primary"
          onClick={() => onSave(rows.filter(r => r.label.trim()))}>Save</button>
      </div>
    </div>
  )
}

function PeopleCell({ value, users, onChange, editing, setEditing, compact }) {
  const ids = value?.user_ids || []
  const selected = users.filter(u => ids.includes(u.id))
  const anchor = useRef(null)
  function toggle(uid) {
    const next = ids.includes(uid) ? ids.filter(i => i !== uid) : [...ids, uid]
    onChange(next.length ? { user_ids: next } : null)
  }
  return (
    <div ref={anchor} className="cell cell-people" onClick={() => setEditing(true)}>
      {selected.length > 0
        ? <AvatarStack users={selected} size={compact ? 22 : 26} />
        : <span className="cell-empty-icon">👤</span>}
      {editing && (
        <OverlayPopover anchorRef={anchor} onClose={() => setEditing(false)} width={230}>
          <div className="people-list">
            {users.filter(u => u.is_active).map(u => (
              <button key={u.id} className={`people-option ${ids.includes(u.id) ? 'selected' : ''}`}
                onClick={() => toggle(u.id)}>
                <Avatar user={u} size={24} />
                <span>{u.display_name}</span>
                {ids.includes(u.id) && <span className="check">✓</span>}
              </button>
            ))}
          </div>
        </OverlayPopover>
      )}
    </div>
  )
}

function DateCell({ value, onChange, editing, setEditing }) {
  const date = value?.date
  const anchor = useRef(null)
  return (
    <div ref={anchor} className={`cell cell-date ${dueClass(date)}`} onClick={() => setEditing(true)}>
      {date ? fmtDate(date) : <span className="cell-empty-icon">📅</span>}
      {editing && (
        <OverlayPopover anchorRef={anchor} onClose={() => setEditing(false)} width={230}>
          <input type="date" autoFocus defaultValue={date || ''}
            onChange={e => { if (e.target.value) { onChange({ date: e.target.value }); setEditing(false) } }} />
          {date && <button className="link-btn" onClick={() => { onChange(null); setEditing(false) }}>Clear date</button>}
        </OverlayPopover>
      )}
    </div>
  )
}

function TextCell({ value, onChange, editing, setEditing }) {
  const text = value?.text || ''
  if (editing) {
    return (
      <div className="cell cell-text">
        <input autoFocus defaultValue={text} className="cell-input"
          onBlur={e => { setEditing(false); const v = e.target.value.trim(); if (v !== text) onChange(v ? { text: v } : null) }}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditing(false) }} />
      </div>
    )
  }
  return (
    <div className="cell cell-text" onClick={() => setEditing(true)} title={text}>
      {text || <span className="cell-empty-icon">＋</span>}
    </div>
  )
}

function NumberCell({ column, value, onChange, editing, setEditing }) {
  const num = value?.number
  const unit = column.settings?.unit || ''
  if (editing) {
    return (
      <div className="cell cell-number">
        <input autoFocus type="number" step="any" defaultValue={num ?? ''} className="cell-input"
          onBlur={e => {
            setEditing(false)
            const v = e.target.value
            onChange(v === '' ? null : { number: parseFloat(v) })
          }}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditing(false) }} />
      </div>
    )
  }
  return (
    <div className="cell cell-number" onClick={() => setEditing(true)}>
      {num !== undefined && num !== null ? `${num}${unit ? ' ' + unit : ''}` : <span className="cell-empty-icon">＋</span>}
    </div>
  )
}

function DropdownCell({ column, value, onChange, onUpdateColumn, editing, setEditing }) {
  const options = column.settings?.options || []
  const ids = value?.ids || []
  const selected = options.filter(o => ids.includes(o.id))
  const [newOpt, setNewOpt] = useState('')

  function toggle(oid) {
    const next = ids.includes(oid) ? ids.filter(i => i !== oid) : [...ids, oid]
    onChange(next.length ? { ids: next } : null)
  }
  function createOption() {
    const label = newOpt.trim()
    if (!label || !onUpdateColumn) return
    const opt = { id: `o${Date.now().toString(36)}`, label, color: LABEL_COLORS[options.length % LABEL_COLORS.length] }
    onUpdateColumn({ ...column.settings, options: [...options, opt] })
    onChange({ ids: [...ids, opt.id] })
    setNewOpt('')
  }

  const anchor = useRef(null)
  return (
    <div ref={anchor} className="cell cell-dropdown" onClick={() => setEditing(true)}>
      {selected.length > 0
        ? <span className="chip-row">{selected.map(o => (
          <span key={o.id} className="chip" style={{ background: o.color }}>{o.label}</span>
        ))}</span>
        : <span className="cell-empty-icon">＋</span>}
      {editing && (
        <OverlayPopover anchorRef={anchor} onClose={() => setEditing(false)} width={230}>
          <div className="people-list">
            {options.map(o => (
              <button key={o.id} className={`people-option ${ids.includes(o.id) ? 'selected' : ''}`}
                onClick={() => toggle(o.id)}>
                <span className="chip" style={{ background: o.color }}>{o.label}</span>
                {ids.includes(o.id) && <span className="check">✓</span>}
              </button>
            ))}
            {options.length === 0 && <div className="muted popover-hint">No options yet — add one below.</div>}
          </div>
          {onUpdateColumn && (
            <div className="dropdown-create">
              <input placeholder="New option…" value={newOpt} onChange={e => setNewOpt(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); createOption() } }} />
              <button className="btn btn-small" onClick={createOption}>Add</button>
            </div>
          )}
        </OverlayPopover>
      )}
    </div>
  )
}
