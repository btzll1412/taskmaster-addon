import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { timeAgo } from '../components/ui'

/** Directory of all departments the user can see. */
export function DepartmentsDirectory() {
  const { workspace, navigate } = useStore()
  const rows = workspace.companies.flatMap(c =>
    c.departments.map(d => ({ ...d, company: c })))

  return (
    <div className="entity-page">
      <div className="entity-head"><h2>🏢 Departments</h2></div>
      {rows.length === 0 && <p className="muted">No departments yet. Open a company and add one.</p>}
      <div className="dir-list">
        {rows.map(d => (
          <button key={d.id} className="dir-row" onClick={() => navigate({ page: 'department', deptId: d.id })}>
            <span className="dir-icon">{d.icon}</span>
            <span className="dir-main">
              <strong>{d.name}</strong>
              <span className="muted">{d.company.name}</span>
            </span>
            <span className="muted">{d.boards.length} board{d.boards.length === 1 ? '' : 's'}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** Directory of all jobs (kind=jobs) or sub-tasks (kind=tasks). */
export function ItemsDirectory({ kind }) {
  const { openBoard, openItem, showToast } = useStore()
  const [items, setItems] = useState(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    api.get(`/api/overview-items?kind=${kind}`)
      .then(d => setItems(d.items))
      .catch(e => showToast(e.message))
  }, [kind])

  const title = kind === 'jobs' ? '📋 All jobs' : '🧩 All tasks'
  const filtered = (items || []).filter(i =>
    !q.trim() || i.name.toLowerCase().includes(q.trim().toLowerCase())
    || i.company_name.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <div className="entity-page">
      <div className="entity-head">
        <h2>{title} {items && <span className="muted">({items.length})</span>}</h2>
        <input className="board-search" placeholder="🔍 Filter…" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {items === null && <p className="muted">Loading…</p>}
      {items?.length === 0 && <p className="muted">Nothing here yet.</p>}
      <div className="dir-list">
        {filtered.map(i => (
          <button key={i.id} className="dir-row" onClick={() => { openBoard(i.board_id); openItem(i.id) }}>
            <span className="dir-icon">{i.board_icon}</span>
            <span className="dir-main">
              <strong>{i.parent_name ? `${i.parent_name} ↳ ${i.name}` : i.name}</strong>
              <span className="muted">{i.company_name}{i.company_name ? ' · ' : ''}{i.board_name}</span>
            </span>
            {i.status && <span className="chip" style={{ background: i.status.color }}>{i.status.label}</span>}
            <span className="muted dir-time">{timeAgo(i.updated_at)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
