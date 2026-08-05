import React, { useState } from 'react'
import { useStore } from '../store'

/** Month calendar: jobs placed on their due date (first date column). */
export default function CalendarView({ items }) {
  const { boardData, openItem } = useStore()
  const { columns } = boardData
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })

  const dateCol = columns.find(c => c.type === 'date')
  const statusCol = columns.find(c => c.type === 'status')
  const labels = statusCol?.settings?.labels || []
  if (!dateCol) {
    return <div className="kanban-empty">Add a Date column to use the Calendar view.</div>
  }

  const byDay = {}
  for (const i of items.filter(i => !i.parent_id)) {
    const d = i.values[String(dateCol.id)]?.date
    if (d) (byDay[d] = byDay[d] || []).push(i)
  }

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const first = new Date(year, month, 1)
  const startOffset = (first.getDay() + 6) % 7  // Monday first
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const todayIso = new Date().toISOString().slice(0, 10)
  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const iso = (d) => `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const colorFor = (i) => {
    const id = statusCol && i.values[String(statusCol.id)]?.id
    return labels.find(l => l.id === id)?.color || 'var(--border)'
  }

  return (
    <div className="calendar-view">
      <div className="calendar-head">
        <button className="icon-btn" onClick={() => setCursor(new Date(year, month - 1, 1))}>‹</button>
        <h3>{cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</h3>
        <button className="icon-btn" onClick={() => setCursor(new Date(year, month + 1, 1))}>›</button>
        <button className="link-btn" onClick={() => {
          const now = new Date(); setCursor(new Date(now.getFullYear(), now.getMonth(), 1))
        }}>Today</button>
      </div>
      <div className="calendar-grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d =>
          <div key={d} className="calendar-dow">{d}</div>)}
        {cells.map((d, idx) => (
          <div key={idx} className={`calendar-cell ${d === null ? 'calendar-empty' : ''} ${d && iso(d) === todayIso ? 'calendar-today' : ''}`}>
            {d && <span className="calendar-daynum">{d}</span>}
            {d && (byDay[iso(d)] || []).map(i => (
              <button key={i.id} className="calendar-job" title={i.name}
                style={{ '--job-color': colorFor(i) }}
                onClick={() => openItem(i.id)}>
                {i.name}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
