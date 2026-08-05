import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import Cell from './Cell'
import { Avatar, OverlayPopover, Popover, fmtDateTime, timeAgo } from './ui'

export default function ItemPanel({ itemId }) {
  const { users, user, boardData, closeItem, refreshBoard, showToast } = useStore()
  const [data, setData] = useState(null)
  const [tab, setTab] = useState('updates')
  const [body, setBody] = useState('')
  const fileInput = useRef(null)

  async function load() {
    try { setData(await api.get(`/api/items/${itemId}`)) }
    catch (e) { showToast(e.message); closeItem() }
  }
  useEffect(() => { setData(null); load() }, [itemId])
  // Refresh panel when the board refreshes (e.g. via SSE)
  useEffect(() => { if (data) load() }, [boardData])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') closeItem() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  if (!data) return null
  const { item, updates, files, activity, subitems, parent } = data
  const cap = (c) => (user.capabilities || []).includes(c)
  const canEditItems = cap('edit_jobs')
  const canCreate = cap('create_jobs')
  const canWrite = (user.capabilities || []).length > 0
  const columns = boardData?.board?.id === item.board_id ? boardData.columns : []
  const assignable = boardData?.board?.id === item.board_id ? boardData.assignable : null
  const jobUsers = (() => {
    if (!assignable) return users
    const ids = new Set(assignable.board_ids)
    for (const id of (assignable.item_ids[String(item.id)] || [])) ids.add(id)
    if (item.parent_id) for (const id of (assignable.item_ids[String(item.parent_id)] || [])) ids.add(id)
    return [...ids].map(id => assignable.users[String(id)]).filter(Boolean)
  })()
  const userById = (id) => (assignable && assignable.users[String(id)]) || users.find(u => u.id === id)

  async function act(promise) {
    try { await promise; await load(); refreshBoard() } catch (e) { showToast(e.message) }
  }

  async function postUpdate(e) {
    e.preventDefault()
    if (!body.trim()) return
    await act(api.post(`/api/items/${item.id}/updates`, { body: body.trim() }))
    setBody('')
  }

  async function uploadFiles(fileList) {
    for (const f of fileList) {
      try { await api.upload(`/api/items/${item.id}/files`, f) }
      catch (e) { showToast(e.message) }
    }
    await load(); refreshBoard()
  }

  return (
    <>
      <div className="panel-backdrop" onClick={closeItem} />
      <aside className="item-panel">
        <div className="panel-head">
          <div className="panel-head-main">
            {parent && (
              <button className="parent-link" onClick={() => useStore.getState().openItem(parent.id)}>
                ↰ {parent.name}
              </button>
            )}
            <ItemPanelName item={item} act={act} canEdit={canEditItems} />
          </div>
          {canEditItems && <MarkDoneButton item={item} columns={columns} act={act} />}
          {canWrite && <FlagButton item={item} users={jobUsers} me={user} showToast={showToast} />}
          <ShareButton item={item} users={users} me={user} boardAccess={boardData?.access} showToast={showToast} />
          <button className="icon-btn" onClick={closeItem}>✕</button>
        </div>

        {!item.parent_id && ((subitems || []).length > 0 || canCreate) && (
          <SubItems item={item} subitems={subitems || []} columns={columns} users={users}
            act={act} canCreate={canCreate} />
        )}

        {columns.length > 0 && (
          <div className="panel-fields">
            {columns.map(col => (
              <div key={col.id} className="panel-field">
                <label>{col.title}</label>
                <Cell column={col} value={item.values[String(col.id)]} users={jobUsers} compact
                  disabled={!canEditItems}
                  onChange={v => act(api.put(`/api/items/${item.id}/values/${col.id}`, { value: v }))} />
              </div>
            ))}
          </div>
        )}

        <div className="panel-tabs">
          <button className={tab === 'updates' ? 'active' : ''} onClick={() => setTab('updates')}>
            💬 Updates {updates.length > 0 && `(${updates.length})`}
          </button>
          <button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>
            📎 Files {files.length > 0 && `(${files.length})`}
          </button>
          <button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>
            📜 Activity
          </button>
        </div>

        <div className="panel-body">
          {tab === 'updates' && (
            <div className="updates-tab">
              {canEditItems && (
                <form className="update-composer" onSubmit={postUpdate}>
                  <MentionTextarea value={body} onChange={setBody} users={jobUsers}
                    onSubmit={postUpdate} />
                  <button className="btn btn-primary btn-small" disabled={!body.trim()}>Update</button>
                </form>
              )}
              {updates.map(u => {
                const author = userById(u.user_id)
                return (
                  <div key={u.id} className="update-card">
                    <div className="update-head">
                      <Avatar user={author} size={28} />
                      <strong>{author?.display_name || 'Unknown'}</strong>
                      <span className="muted">{timeAgo(u.created_at)}</span>
                      {(u.user_id === user.id || user.role === 'super_admin' || user.role === 'company_admin') && (
                        <button className="icon-btn update-del" title="Delete"
                          onClick={() => { if (confirm('Delete this update?')) act(api.del(`/api/updates/${u.id}`)) }}>✕</button>
                      )}
                    </div>
                    <div className="update-body">{u.body}</div>
                  </div>
                )
              })}
              {updates.length === 0 && <div className="muted panel-empty">No updates yet. Start the conversation!</div>}
            </div>
          )}

          {tab === 'files' && (
            <div className="files-tab">
              {canEditItems && (
                <>
                  <button className="btn btn-secondary" onClick={() => fileInput.current.click()}>
                    📤 Upload files
                  </button>
                  <input type="file" ref={fileInput} multiple hidden
                    onChange={e => { uploadFiles([...e.target.files]); e.target.value = '' }} />
                </>
              )}
              <div className="files-grid">
                {files.map(f => (
                  <div key={f.id} className="file-card">
                    {f.is_image ? (
                      <a href={`/api/files/${f.id}/download`} target="_blank" rel="noreferrer">
                        <img src={`/api/files/${f.id}/download`} alt={f.original_filename} loading="lazy" />
                      </a>
                    ) : (
                      <a className="file-icon" href={`/api/files/${f.id}/download`} target="_blank" rel="noreferrer">📄</a>
                    )}
                    <div className="file-meta">
                      <a href={`/api/files/${f.id}/download`} target="_blank" rel="noreferrer" className="file-name"
                        title={f.original_filename}>{f.original_filename}</a>
                      <span className="muted">{fmtSize(f.file_size)} · {userById(f.user_id)?.display_name || ''}</span>
                    </div>
                    {(f.user_id === user.id || user.role === 'super_admin' || user.role === 'company_admin') && (
                      <button className="icon-btn" title="Delete"
                        onClick={() => { if (confirm('Delete this file?')) act(api.del(`/api/files/${f.id}`)) }}>✕</button>
                    )}
                  </div>
                ))}
              </div>
              {files.length === 0 && <div className="muted panel-empty">No files yet.</div>}
            </div>
          )}

          {tab === 'activity' && (
            <div className="activity-tab">
              {activity.map(a => {
                const actor = userById(a.user_id)
                return (
                  <div key={a.id} className="activity-row">
                    <Avatar user={actor} size={24} />
                    <span><strong>{actor?.display_name || 'Someone'}</strong> {a.description}</span>
                    <span className="muted">{fmtDateTime(a.created_at)}</span>
                  </div>
                )
              })}
              {activity.length === 0 && <div className="muted panel-empty">No activity recorded.</div>}
            </div>
          )}
        </div>
      </aside>
    </>
  )
}

/** Update composer textarea: typing @ pops a filtered people picker;
 * picking someone inserts their @username plus a trailing space. */
function MentionTextarea({ value, onChange, users, onSubmit }) {
  const ref = useRef(null)
  const [mention, setMention] = useState(null) // {start, query}
  const [highlight, setHighlight] = useState(0)

  function detect(text, caret) {
    const before = text.slice(0, caret)
    const m = before.match(/@([A-Za-z0-9_.\-]*)$/)
    if (!m) return null
    const start = caret - m[1].length - 1
    if (start > 0 && !/[\s]/.test(before[start - 1])) return null  // mid-word @
    return { start, query: m[1].toLowerCase() }
  }

  const matches = mention
    ? users.filter(u => u.is_active !== false &&
        (u.username.toLowerCase().startsWith(mention.query) ||
         u.display_name.toLowerCase().includes(mention.query))).slice(0, 8)
    : []

  function handleChange(e) {
    onChange(e.target.value)
    setMention(detect(e.target.value, e.target.selectionStart))
    setHighlight(0)
  }

  function pick(u) {
    const el = ref.current
    const caret = el.selectionStart
    const next = value.slice(0, mention.start) + '@' + u.username + ' ' + value.slice(caret)
    onChange(next)
    setMention(null)
    requestAnimationFrame(() => {
      el.focus()
      const pos = mention.start + u.username.length + 2
      el.setSelectionRange(pos, pos)
    })
  }

  function handleKey(e) {
    if (mention && matches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => (h + 1) % matches.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => (h - 1 + matches.length) % matches.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[highlight]); return }
      if (e.key === 'Escape') { setMention(null); return }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit(e)
  }

  return (
    <div className="mention-box">
      <textarea ref={ref} placeholder="Write an update… type @ to flag someone" value={value} rows={3}
        onChange={handleChange} onKeyDown={handleKey}
        onClick={e => setMention(detect(e.target.value, e.target.selectionStart))}
        onBlur={() => setTimeout(() => setMention(null), 200)} />
      {mention && matches.length > 0 && (
        <div className="mention-pop">
          {matches.map((u, i) => (
            <button key={u.id} type="button"
              className={`people-option ${i === highlight ? 'mention-active' : ''}`}
              onMouseDown={e => { e.preventDefault(); pick(u) }}
              onMouseEnter={() => setHighlight(i)}>
              <Avatar user={u} size={22} />
              <span>{u.display_name}</span>
              <span className="muted">@{u.username}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Quick status control in the panel header: shows the current status in its
 * color and opens the board's full label list — same options as the board. */
function MarkDoneButton({ item, columns, act }) {
  const [open, setOpen] = useState(false)
  const anchor = useRef(null)
  const statusCol = columns.find(c => c.type === 'status')
  const labels = statusCol?.settings?.labels || []
  if (!statusCol || labels.length === 0) return null
  const currentId = item.values?.[String(statusCol.id)]?.id
  const current = labels.find(l => l.id === currentId)
  const done = labels.find(l => l.label.trim().toLowerCase() === 'done')
  const set = (value) => {
    setOpen(false)
    act(api.put(`/api/items/${item.id}/values/${statusCol.id}`, { value }))
  }
  return (
    <div className="topbar-anchor" ref={anchor}>
      <button
        className={`btn btn-small ${current ? 'btn-status-current' : 'btn-mark-done'}`}
        style={current ? { background: current.color, borderColor: current.color, color: '#fff' } : undefined}
        title="Change status"
        onClick={() => setOpen(true)}>
        {current ? current.label : done ? '✓ Mark done' : '＋ Status'}
      </button>
      {open && (
        <OverlayPopover anchorRef={anchor} onClose={() => setOpen(false)} width={200}>
          {labels.map(l => (
            <button key={l.id} className="label-option" style={{ background: l.color }}
              onClick={() => set({ id: l.id })}>
              {l.label}{currentId === l.id ? ' ✓' : ''}
            </button>
          ))}
          {current && (
            <button className="label-option label-clear" onClick={() => set(null)}>
              Clear status
            </button>
          )}
        </OverlayPopover>
      )}
    </div>
  )
}

function ItemPanelName({ item, act, canEdit }) {
  const [editing, setEditing] = useState(false)
  if (!canEdit) return <h3 className="panel-name">{item.name}</h3>
  if (editing) {
    return (
      <input className="panel-name-input" autoFocus defaultValue={item.name}
        onBlur={e => { setEditing(false); const v = e.target.value.trim(); if (v && v !== item.name) act(api.put(`/api/items/${item.id}`, { name: v })) }}
        onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditing(false) }} />
    )
  }
  return <h3 className="panel-name" onClick={() => setEditing(true)}>{item.name}</h3>
}

function SubItems({ item, subitems, columns, users, act, canCreate }) {
  const [name, setName] = useState('')
  const { openItem } = useStore()
  const statusCol = columns.find(c => c.type === 'status')

  return (
    <div className="panel-subitems">
      <label>Sub-tasks {subitems.length > 0 && `(${subitems.length})`}</label>
      {subitems.map(si => {
        const label = statusCol
          ? (statusCol.settings?.labels || []).find(l => l.id === si.values?.[String(statusCol.id)]?.id)
          : null
        return (
          <button key={si.id} className="subitem-row" onClick={() => openItem(si.id)}>
            <span className="sub-indent">↳</span>
            <span className="subitem-name">{si.name}</span>
            {label && <span className="chip" style={{ background: label.color }}>{label.label}</span>}
          </button>
        )
      })}
      {canCreate && (
        <form className="add-sub-form" onSubmit={async (e) => {
          e.preventDefault()
          const v = name.trim()
          if (!v) return
          setName('')
          await act(api.post(`/api/boards/${item.board_id}/items`, { name: v, parent_id: item.id }))
        }}>
          <input placeholder="＋ Add sub-task" value={name} onChange={e => setName(e.target.value)} />
        </form>
      )}
    </div>
  )
}

function FlagButton({ item, users, me, showToast }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="topbar-anchor">
      <button className="btn btn-small" title="Notify someone about this job" onClick={() => setOpen(!open)}>
        🚩 Flag
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} align="right" width={230}>
          <div className="people-list">
            {users.filter(u => u.is_active && u.id !== me.id).map(u => (
              <button key={u.id} className="people-option" onClick={async () => {
                setOpen(false)
                try {
                  await api.post(`/api/items/${item.id}/flag`, { user_id: u.id })
                  showToast(`Flagged ${u.display_name} 🚩`)
                } catch (e) { showToast(e.message) }
              }}>
                <Avatar user={u} size={24} />
                <span>{u.display_name}</span>
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  )
}

function ShareButton({ item, users, me, boardAccess, showToast }) {
  const [open, setOpen] = useState(false)
  const canShare = boardAccess === 'full' &&
    (me.role === 'super_admin' || me.role === 'company_admin')
  if (!canShare) return null
  return (
    <div className="topbar-anchor">
      <button className="btn btn-small" title="Give someone access to this single job" onClick={() => setOpen(!open)}>
        🔑 Share access
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} align="right" width={250}>
          <div className="muted popover-hint">Grant access to this job only:</div>
          <div className="people-list">
            {users.filter(u => u.is_active && u.id !== me.id && u.role !== 'super_admin').map(u => (
              <button key={u.id} className="people-option" onClick={async () => {
                setOpen(false)
                try {
                  await api.post(`/api/users/${u.id}/grants`, { scope_type: 'item', scope_id: item.id })
                  showToast(`${u.display_name} can now see "${item.name}"`)
                } catch (e) { showToast(e.message) }
              }}>
                <Avatar user={u} size={24} />
                <span>{u.display_name}</span>
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  )
}

function fmtSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
