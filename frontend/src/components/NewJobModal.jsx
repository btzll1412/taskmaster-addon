import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { Modal } from './ui'

/** Start a new job: name + optional template + optional immediate assignee. */
export default function NewJobModal({ board, assignableUsers, onClose, onCreated, showToast }) {
  const { navigate } = useStore()
  const [name, setName] = useState('')
  const [templates, setTemplates] = useState(null)
  const [templateId, setTemplateId] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get('/api/templates')
      .then(setTemplates)
      .catch(() => setTemplates({ mine: [], shared: [] }))
  }, [])

  const picked = templates && [...templates.mine, ...templates.shared]
    .find(t => String(t.id) === templateId)

  async function create(e) {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const payload = { name: name.trim() }
      if (templateId) payload.template_id = Number(templateId)
      if (assigneeId) payload.assignee_id = Number(assigneeId)
      await api.post(`/api/boards/${board.id}/items`, payload)
      onCreated()
    } catch (err) {
      showToast(err.message)
      setBusy(false)
    }
  }

  return (
    <Modal title={`New job — ${board.name}`} onClose={onClose}>
      <form className="form-col" onSubmit={create}>
        <label>Job name</label>
        <input placeholder="What needs to be done?" value={name} autoFocus
          onChange={e => setName(e.target.value)} required />

        <label>Start from</label>
        <select value={templateId} onChange={e => setTemplateId(e.target.value)}>
          <option value="">📄 Start with empty</option>
          {templates?.mine.length > 0 && (
            <optgroup label="My templates">
              {templates.mine.map(t => (
                <option key={t.id} value={t.id}>{t.icon} {t.name}</option>
              ))}
            </optgroup>
          )}
          {templates?.shared.length > 0 && (
            <optgroup label="Shared templates">
              {templates.shared.map(t => (
                <option key={t.id} value={t.id}>{t.icon} {t.name} — by {t.owner_name}</option>
              ))}
            </optgroup>
          )}
        </select>
        {picked && (picked.data.subtasks || []).length > 0 && (
          <div className="muted template-preview">
            Includes {picked.data.subtasks.length} sub-task{picked.data.subtasks.length === 1 ? '' : 's'}:{' '}
            {picked.data.subtasks.map(s => s.name).join(', ')}
          </div>
        )}

        <label>Assign to <span className="muted">(optional)</span></label>
        <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
          <option value="">— nobody yet —</option>
          {assignableUsers.map(u => (
            <option key={u.id} value={u.id}>{u.display_name}</option>
          ))}
        </select>

        <div className="form-row new-job-foot">
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create job'}</button>
          <button type="button" className="link-btn"
            onClick={() => { onClose(); navigate({ page: 'templates' }) }}>
            Manage templates
          </button>
        </div>
      </form>
    </Modal>
  )
}
