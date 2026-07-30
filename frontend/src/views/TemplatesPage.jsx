import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { Modal, EmojiPicker } from '../components/ui'

const STATUS_CHOICES = ['Not Started', 'Working on it', 'Stuck', 'Done']
const PRIORITY_CHOICES = ['Critical', 'High', 'Medium', 'Low']

export default function TemplatesPage() {
  const { showToast } = useStore()
  const [data, setData] = useState(null)
  const [editing, setEditing] = useState(null) // null | 'new' | template object

  async function load() {
    try { setData(await api.get('/api/templates')) }
    catch (e) { showToast(e.message) }
  }
  useEffect(() => { load() }, [])

  if (!data) return <div className="muted page-loading">Loading…</div>

  async function toggleShare(t) {
    try {
      await api.put(`/api/templates/${t.id}`, { shared: !t.shared })
      await load()
    } catch (e) { showToast(e.message) }
  }

  return (
    <div className="entity-page">
      <div className="entity-head">
        <h2>📦 Job templates</h2>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>＋ New template</button>
      </div>
      <p className="muted">
        A template pre-fills a new job: default status &amp; priority plus its own copy of a sub-task
        checklist. Share a template and everyone can start jobs from it too.
      </p>

      <section className="entity-section">
        <h3>My templates</h3>
        <div className="template-list">
          {data.mine.length === 0 && <span className="muted">No templates yet — create your first one.</span>}
          {data.mine.map(t => (
            <TemplateCard key={t.id} t={t} mine
              onEdit={() => setEditing(t)} onShare={() => toggleShare(t)}
              onDelete={async () => {
                if (!confirm(`Delete template "${t.name}"?`)) return
                try { await api.del(`/api/templates/${t.id}`); await load() } catch (e) { showToast(e.message) }
              }} />
          ))}
        </div>
      </section>

      <section className="entity-section">
        <h3>🌐 Shared by others</h3>
        <div className="template-list">
          {data.shared.length === 0 && <span className="muted">Nobody has shared a template yet.</span>}
          {data.shared.map(t => <TemplateCard key={t.id} t={t} />)}
        </div>
      </section>

      {editing && (
        <TemplateEditor template={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }} showToast={showToast} />
      )}
    </div>
  )
}

function TemplateCard({ t, mine, onEdit, onShare, onDelete }) {
  const status = t.data.values?.find(v => v.type === 'status')?.label
  const priority = t.data.values?.find(v => v.type === 'priority')?.label
  const subs = t.data.subtasks || []
  return (
    <div className="template-card">
      <div className="template-card-head">
        <span className="template-icon">{t.icon}</span>
        <strong className="template-name">{t.name}</strong>
        {!mine && <span className="muted template-owner">by {t.owner_name}</span>}
        {mine && (
          <label className="radio-row template-share" title="Shared templates can be used by everyone">
            <input type="checkbox" checked={t.shared} onChange={onShare} />
            <span>Share</span>
          </label>
        )}
        {mine && <button className="icon-btn" title="Edit" onClick={onEdit}>✏️</button>}
        {mine && <button className="icon-btn" title="Delete" onClick={onDelete}>🗑️</button>}
      </div>
      <div className="template-card-body">
        {status && <span className="chip" style={{ background: '#fdab3d' }}>{status}</span>}
        {priority && <span className="chip" style={{ background: '#5559df' }}>{priority}</span>}
        {subs.length > 0 && (
          <span className="muted">{subs.length} sub-task{subs.length === 1 ? '' : 's'}: {subs.slice(0, 4).map(s => s.name).join(', ')}{subs.length > 4 ? '…' : ''}</span>
        )}
        {!status && !priority && subs.length === 0 && <span className="muted">Empty template</span>}
      </div>
    </div>
  )
}

export function TemplateEditor({ template, onClose, onSaved, showToast }) {
  const [name, setName] = useState(template?.name || '')
  const [icon, setIcon] = useState(template?.icon || '📦')
  const [status, setStatus] = useState(template?.data.values?.find(v => v.type === 'status')?.label || '')
  const [priority, setPriority] = useState(template?.data.values?.find(v => v.type === 'priority')?.label || '')
  const [subtasks, setSubtasks] = useState((template?.data.subtasks || []).map(s => s.name))
  const [newSub, setNewSub] = useState('')

  function addSub() {
    const v = newSub.trim()
    if (!v) return
    setSubtasks([...subtasks, v])
    setNewSub('')
  }

  async function save() {
    if (!name.trim()) { showToast('Template name is required'); return }
    const data = {
      values: [
        ...(status ? [{ title: 'Status', type: 'status', label: status }] : []),
        ...(priority ? [{ title: 'Priority', type: 'priority', label: priority }] : []),
      ],
      subtasks: subtasks.map(n => ({ name: n })),
    }
    try {
      if (template) await api.put(`/api/templates/${template.id}`, { name: name.trim(), icon, data })
      else await api.post('/api/templates', { name: name.trim(), icon, data })
      onSaved()
    } catch (e) { showToast(e.message) }
  }

  return (
    <Modal title={template ? `Edit template — ${template.name}` : 'New job template'} onClose={onClose} wide>
      <div className="form-col">
        <div className="form-row">
          <EmojiPicker value={icon} onChange={setIcon} />
          <input placeholder="Template name (e.g. Camera installation)" value={name} autoFocus
            onChange={e => setName(e.target.value)} />
        </div>
        <div className="form-row">
          <div className="form-col-half">
            <label>Default status</label>
            <select value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">— none —</option>
              {STATUS_CHOICES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="form-col-half">
            <label>Default priority</label>
            <select value={priority} onChange={e => setPriority(e.target.value)}>
              <option value="">— none —</option>
              {PRIORITY_CHOICES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <label>Sub-tasks <span className="muted">(every job started from this template gets its own copy)</span></label>
        <div className="template-subs">
          {subtasks.map((s, i) => (
            <div key={i} className="template-sub-row">
              <span className="sub-indent">↳</span>
              <input value={s} onChange={e => {
                const next = [...subtasks]; next[i] = e.target.value; setSubtasks(next)
              }} />
              <button className="icon-btn" title="Remove" onClick={() => setSubtasks(subtasks.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <div className="template-sub-row">
            <span className="sub-indent">＋</span>
            <input placeholder="Add a sub-task (e.g. Order cameras) and press Enter" value={newSub}
              onChange={e => setNewSub(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSub() } }} />
            <button className="btn btn-small" onClick={addSub}>Add</button>
          </div>
        </div>

        <div><button className="btn btn-primary" onClick={save}>{template ? 'Save template' : 'Create template'}</button></div>
      </div>
    </Modal>
  )
}
