import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { Avatar, Modal } from './ui'

/** Board automations: "when <status column> becomes <label> → notify <people>". */
export default function RulesModal({ board, columns, onClose }) {
  const { users, showToast } = useStore()
  const [rules, setRules] = useState(null)
  const statusCols = columns.filter(c => c.type === 'status' || c.type === 'priority')
  const [columnId, setColumnId] = useState(statusCols[0]?.id || '')
  const [labelId, setLabelId] = useState('')
  const [picked, setPicked] = useState([])

  async function load() {
    try { setRules((await api.get(`/api/boards/${board.id}/rules`)).rules) }
    catch (e) { showToast(e.message) }
  }
  useEffect(() => { load() }, [board.id])

  const col = statusCols.find(c => c.id === Number(columnId))
  const labels = col?.settings?.labels || []
  const userById = (id) => users.find(u => u.id === id)

  async function addRule() {
    if (!columnId || picked.length === 0) {
      showToast('Pick a status and at least one person'); return
    }
    try {
      await api.post(`/api/boards/${board.id}/rules`, {
        column_id: Number(columnId),
        label_id: labelId || null,
        user_ids: picked,
      })
      setPicked([]); setLabelId('')
      await load()
    } catch (e) { showToast(e.message) }
  }

  async function removeRule(r) {
    try { await api.del(`/api/rules/${r.id}`); await load() }
    catch (e) { showToast(e.message) }
  }

  function describe(r) {
    const c = columns.find(x => x.id === r.column_id)
    const label = c?.settings?.labels?.find(l => l.id === r.label_id)
    const who = r.user_ids.map(id => userById(id)?.display_name || '?').join(', ')
    return {
      when: label ? `${c?.title || '?'} becomes` : `${c?.title || '?'} changes`,
      label,
      who,
    }
  }

  return (
    <Modal title={`Automations — ${board.name}`} onClose={onClose} wide>
      {statusCols.length === 0 ? (
        <p className="muted">Add a Status column to this board first.</p>
      ) : (
        <div className="rules-modal">
          <div className="rules-list">
            {rules === null && <div className="muted">Loading…</div>}
            {rules?.length === 0 && <div className="muted">No automations yet — add one below.</div>}
            {rules?.map(r => {
              const d = describe(r)
              return (
                <div key={r.id} className="rule-row">
                  <span className="rule-text">
                    When <strong>{d.when}</strong>
                    {d.label && <span className="chip" style={{ background: d.label.color }}>{d.label.label}</span>}
                    {' '}→ notify <strong>{d.who}</strong>
                  </span>
                  <button className="icon-btn" title="Delete rule" onClick={() => removeRule(r)}>✕</button>
                </div>
              )
            })}
          </div>

          <h4>New automation</h4>
          <div className="rule-form">
            <span>When</span>
            <select value={columnId} onChange={e => { setColumnId(e.target.value); setLabelId('') }}>
              {statusCols.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <span>becomes</span>
            <select value={labelId} onChange={e => setLabelId(e.target.value)}>
              <option value="">any status</option>
              {labels.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
            <span>notify:</span>
          </div>
          <div className="rule-people">
            {users.filter(u => u.is_active).map(u => (
              <button key={u.id}
                className={`rule-person ${picked.includes(u.id) ? 'selected' : ''}`}
                onClick={() => setPicked(picked.includes(u.id)
                  ? picked.filter(i => i !== u.id) : [...picked, u.id])}>
                <Avatar user={u} size={22} /> {u.display_name}
              </button>
            ))}
          </div>
          <button className="btn btn-primary" onClick={addRule}>Add automation</button>
        </div>
      )}
    </Modal>
  )
}
