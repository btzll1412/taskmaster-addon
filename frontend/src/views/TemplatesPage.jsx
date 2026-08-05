import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { Modal, EmojiPicker, OverlayPopover } from '../components/ui'

const STATUS_LABELS = [
  { label: 'Not Started', color: '#c4c4c4' },
  { label: 'Working on it', color: '#fdab3d' },
  { label: 'Stuck', color: '#e2445c' },
  { label: 'Done', color: '#00c875' },
]
const PRIORITY_LABELS = [
  { label: 'Critical', color: '#333333' },
  { label: 'High', color: '#401694' },
  { label: 'Medium', color: '#5559df' },
  { label: 'Low', color: '#579bfc' },
]

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

      <RecurringSection showToast={showToast} />

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

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function RecurringSection({ showToast }) {
  const [data, setData] = useState(null)
  async function load() {
    try { setData(await api.get('/api/recurring')) } catch { /* ignore */ }
  }
  useEffect(() => { load() }, [])
  if (!data || data.recurring.length === 0) return null

  const scheduleText = (r) =>
    r.frequency === 'daily' ? 'every day'
      : r.frequency === 'weekly' ? `every ${WEEKDAYS[r.weekday || 0]}`
        : `every month on the ${r.monthday}`

  return (
    <section className="entity-section">
      <h3>🔁 Recurring jobs</h3>
      <div className="template-list">
        {data.recurring.map(r => (
          <div key={r.id} className={`template-card ${r.enabled ? '' : 'automation-off'}`}>
            <div className="template-card-head">
              <span className="template-icon">{r.board_icon}</span>
              <strong className="template-name">{r.name}</strong>
              <span className="muted">{r.board_name} · {scheduleText(r)}
                {r.assignee_id ? ` · → ${data.user_names[String(r.assignee_id)] || '?'}` : ''}
                {r.template_id ? ` · 📦 ${data.template_names[String(r.template_id)] || ''}` : ''}</span>
              <label className="switch" title={r.enabled ? 'On' : 'Paused'}>
                <input type="checkbox" checked={r.enabled} onChange={async () => {
                  try { await api.put(`/api/recurring/${r.id}`, { enabled: !r.enabled }); load() }
                  catch (e) { showToast(e.message) }
                }} />
                <span className="switch-slider" />
              </label>
              <button className="icon-btn" title="Delete recurring job" onClick={async () => {
                if (!confirm(`Stop creating "${r.name}" automatically?`)) return
                try { await api.del(`/api/recurring/${r.id}`); load() } catch (e) { showToast(e.message) }
              }}>🗑️</button>
            </div>
            <div className="template-card-body">
              <span className="muted">Next run: {r.next_run_at ? new Date(r.next_run_at).toLocaleDateString() : '—'}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="muted">Create recurring jobs from any board's ＋ New job popup (Repeat option).</p>
    </section>
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

/** One editable row of the designer: {name?, status, priority, days, text}. */
function rowFromSpecs(specs) {
  const by = (t) => (specs || []).find(v => v.type === t) || {}
  return {
    status: by('status').label || '',
    priority: by('priority').label || '',
    days: by('date').days ?? '',
    text: by('text').text || '',
  }
}

function specsFromRow(row) {
  return [
    ...(row.status ? [{ title: 'Status', type: 'status', label: row.status }] : []),
    ...(row.priority ? [{ title: 'Priority', type: 'priority', label: row.priority }] : []),
    ...(row.days !== '' && row.days !== null ? [{ title: 'Due date', type: 'date', days: Number(row.days) }] : []),
    ...(row.text ? [{ title: 'Notes', type: 'text', text: row.text }] : []),
  ]
}

/** Colored status/priority chip that opens an overlay label picker — same feel as a board cell. */
function ChipPicker({ value, labels, placeholder, onChange }) {
  const [open, setOpen] = useState(false)
  const anchor = useRef(null)
  const current = labels.find(l => l.label === value)
  return (
    <div className="topbar-anchor" ref={anchor}>
      <button type="button"
        className={`tpl-chip ${current ? '' : 'tpl-chip-empty'}`}
        style={current ? { background: current.color } : undefined}
        onClick={() => setOpen(true)}>
        {current ? current.label : placeholder}
      </button>
      {open && (
        <OverlayPopover anchorRef={anchor} onClose={() => setOpen(false)} width={180}>
          {labels.map(l => (
            <button key={l.label} type="button" className="menu-item"
              onClick={() => { onChange(l.label); setOpen(false) }}>
              <span className="tpl-chip" style={{ background: l.color, minWidth: 0, padding: '3px 10px' }}>{l.label}</span>
            </button>
          ))}
          <hr className="menu-sep" />
          <button type="button" className="menu-item" onClick={() => { onChange(''); setOpen(false) }}>✕ Clear</button>
        </OverlayPopover>
      )}
    </div>
  )
}

function DesignerRow({ row, onChange, name, onRemove, isJob }) {
  const set = (k) => (v) => onChange({ ...row, [k]: v })
  return (
    <tr className={isJob ? 'template-job-row' : ''}>
      <td>{name}</td>
      <td><ChipPicker value={row.status} labels={STATUS_LABELS} placeholder="＋ Status" onChange={set('status')} /></td>
      <td><ChipPicker value={row.priority} labels={PRIORITY_LABELS} placeholder="＋ Priority" onChange={set('priority')} /></td>
      <td>
        <input type="number" className="template-days" min="0" max="365" placeholder="—"
          title="Due this many days after the job is created"
          value={row.days} onChange={e => set('days')(e.target.value)} />
      </td>
      <td><input placeholder="＋ Note" value={row.text} onChange={e => set('text')(e.target.value)} /></td>
      <td>{onRemove && <button type="button" className="icon-btn" title="Remove sub-task" onClick={onRemove}>✕</button>}</td>
    </tr>
  )
}

export function TemplateEditor({ template, onClose, onSaved, showToast }) {
  const [name, setName] = useState(template?.name || '')
  const [icon, setIcon] = useState(template?.icon || '📦')
  const [job, setJob] = useState(rowFromSpecs(template?.data.values))
  const [subs, setSubs] = useState((template?.data.subtasks || [])
    .map(s => ({ name: s.name, ...rowFromSpecs(s.values) })))
  const [newSub, setNewSub] = useState('')

  function addSub() {
    const v = newSub.trim()
    if (!v) return
    setSubs([...subs, { name: v, status: '', priority: '', days: '', text: '' }])
    setNewSub('')
  }

  function moveSub(i, dir) {
    const j = i + dir
    if (j < 0 || j >= subs.length) return
    const next = [...subs]
    ;[next[i], next[j]] = [next[j], next[i]]
    setSubs(next)
  }

  async function save() {
    if (!name.trim()) { showToast('Template name is required'); return }
    const data = {
      values: specsFromRow(job),
      subtasks: subs.filter(s => s.name.trim())
        .map(s => ({ name: s.name.trim(), values: specsFromRow(s) })),
    }
    try {
      if (template) await api.put(`/api/templates/${template.id}`, { name: name.trim(), icon, data })
      else await api.post('/api/templates', { name: name.trim(), icon, data })
      onSaved()
    } catch (e) { showToast(e.message) }
  }

  return (
    <Modal title={template ? `Edit template — ${template.name}` : 'New job template'} onClose={onClose} wide>
      <div className="template-modal-body">
        <div className="form-row">
          <EmojiPicker value={icon} onChange={setIcon} />
          <input placeholder="Template name (e.g. Camera installation)" value={name} autoFocus
            onChange={e => setName(e.target.value)} />
        </div>

        <div className="template-table-wrap">
          <table className="template-table">
            <thead>
              <tr>
                <th>Item</th><th>Status</th><th>Priority</th><th>Due in (days)</th><th>Notes</th><th></th>
              </tr>
            </thead>
            <tbody>
              <DesignerRow row={job} onChange={setJob} isJob
                name={<span>📌 The job itself</span>} />
              {subs.map((s, i) => (
                <DesignerRow key={i} row={s}
                  onChange={next => setSubs(subs.map((x, j) => j === i ? next : x))}
                  onRemove={() => setSubs(subs.filter((_, j) => j !== i))}
                  name={
                    <span className="tpl-sub-name">
                      <span className="sub-indent">↳</span>
                      <input value={s.name}
                        onChange={e => setSubs(subs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                      <button type="button" className="icon-btn" title="Move up" disabled={i === 0}
                        onClick={() => moveSub(i, -1)}>↑</button>
                      <button type="button" className="icon-btn" title="Move down" disabled={i === subs.length - 1}
                        onClick={() => moveSub(i, 1)}>↓</button>
                    </span>
                  } />
              ))}
              <tr>
                <td colSpan={6}>
                  <div className="tpl-sub-name">
                    <span className="sub-indent">＋</span>
                    <input placeholder="Add a sub-task (e.g. Order cameras) and press Enter" value={newSub}
                      onChange={e => setNewSub(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSub() } }} />
                    <button type="button" className="btn btn-small" onClick={addSub}>Add</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          "Due in" sets the due date that many days after the job is created.
          Every job started from this template gets its own copy of everything above.
        </p>

        <div><button className="btn btn-primary" onClick={save}>{template ? 'Save template' : 'Create template'}</button></div>
      </div>
    </Modal>
  )
}
