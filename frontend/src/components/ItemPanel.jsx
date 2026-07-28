import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import Cell from './Cell'
import { Avatar, fmtDateTime, timeAgo } from './ui'

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
  const { item, updates, files, activity } = data
  const columns = boardData?.board?.id === item.board_id ? boardData.columns : []
  const userById = (id) => users.find(u => u.id === id)

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
          <ItemPanelName item={item} act={act} />
          <button className="icon-btn" onClick={closeItem}>✕</button>
        </div>

        {columns.length > 0 && (
          <div className="panel-fields">
            {columns.map(col => (
              <div key={col.id} className="panel-field">
                <label>{col.title}</label>
                <Cell column={col} value={item.values[String(col.id)]} users={users} compact
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
                <textarea placeholder="Write an update… " value={body} rows={3}
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
                      {(u.user_id === user.id || user.role === 'admin') && (
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
                    {(f.user_id === user.id || user.role === 'admin') && (
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

function fmtSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
