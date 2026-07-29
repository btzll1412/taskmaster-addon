import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import Cell from './Cell'
import { Avatar, Popover, fmtDateTime, timeAgo } from './ui'

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
            <ItemPanelName item={item} act={act} />
          </div>
          <FlagButton item={item} users={jobUsers} me={user} showToast={showToast} />
          <ShareButton item={item} users={users} me={user} boardAccess={boardData?.access} showToast={showToast} />
          <button className="icon-btn" onClick={closeItem}>✕</button>
        </div>

        {!item.parent_id && (
          <SubItems item={item} subitems={subitems || []} columns={columns} users={users} act={act} />
        )}

        {columns.length > 0 && (
          <div className="panel-fields">
            {columns.map(col => (
              <div key={col.id} className="panel-field">
                <label>{col.title}</label>
                <Cell column={col} value={item.values[String(col.id)]} users={jobUsers} compact
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
              <form className="update-composer" onSubmit={postUpdate}>
                <textarea placeholder="Write an update… use @username to flag someone" value={body} rows={3}
                  onChange={e => setBody(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) postUpdate(e) }} />
                <button className="btn btn-primary btn-small" disabled={!body.trim()}>Update</button>
              </form>
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
              <button className="btn btn-secondary" onClick={() => fileInput.current.click()}>
                📤 Upload files
              </button>
              <input type="file" ref={fileInput} multiple hidden
                onChange={e => { uploadFiles([...e.target.files]); e.target.value = '' }} />
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

function ItemPanelName({ item, act }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <input className="panel-name-input" autoFocus defaultValue={item.name}
        onBlur={e => { setEditing(false); const v = e.target.value.trim(); if (v && v !== item.name) act(api.put(`/api/items/${item.id}`, { name: v })) }}
        onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditing(false) }} />
    )
  }
  return <h3 className="panel-name" onClick={() => setEditing(true)}>{item.name}</h3>
}

function SubItems({ item, subitems, columns, users, act }) {
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
      <form className="add-sub-form" onSubmit={async (e) => {
        e.preventDefault()
        const v = name.trim()
        if (!v) return
        setName('')
        await act(api.post(`/api/boards/${item.board_id}/items`, { name: v, parent_id: item.id }))
      }}>
        <input placeholder="＋ Add sub-task" value={name} onChange={e => setName(e.target.value)} />
      </form>
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
