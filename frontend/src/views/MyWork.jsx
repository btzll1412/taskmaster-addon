import React, { useEffect, useMemo } from 'react'
import { useStore } from '../store'
import { fmtDate, dueClass } from '../components/ui'

export default function MyWork() {
  const { myWork, refreshMyWork, openBoard, openItem } = useStore()

  useEffect(() => { refreshMyWork() }, [])

  const sections = useMemo(() => {
    if (!myWork) return []
    const items = myWork.items.map(i => {
      const cols = myWork.columns[String(i.board_id)] || []
      const dateCol = cols.find(c => c.type === 'date')
      const statusCol = cols.find(c => c.type === 'status')
      const status = statusCol
        ? (statusCol.settings?.labels || []).find(l => l.id === i.values[String(statusCol.id)]?.id)
        : null
      return {
        ...i,
        due: dateCol ? i.values[String(dateCol.id)]?.date : null,
        status,
        board: myWork.boards[String(i.board_id)],
        group: myWork.groups[String(i.group_id)],
      }
    }).filter(i => i.board && !i.board.archived)

    // one section per company; inside: dated jobs first (soonest on top,
    // overdue naturally rise), then no-date, Done last
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const isDone = (i) => i.status?.label?.toLowerCase() === 'done'
    const isOverdue = (i) => !isDone(i) && i.due && new Date(i.due + 'T00:00:00') < today
    const rank = (i) => isDone(i) ? 2 : i.due ? 0 : 1
    const byCompany = new Map()
    for (const i of items) {
      const key = i.board.company_name || 'Other'
      if (!byCompany.has(key)) byCompany.set(key, [])
      byCompany.get(key).push(i)
    }
    return [...byCompany.entries()]
      .map(([company, list]) => {
        list.sort((a, b) => rank(a) - rank(b)
          || ((a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0))
        return { company, items: list, overdue: list.filter(isOverdue).length }
      })
      .sort((a, b) => b.overdue - a.overdue || a.company.localeCompare(b.company))
  }, [myWork])

  if (!myWork) return <div className="muted my-work-loading">Loading…</div>

  return (
    <div className="my-work">
      <h2>My Work</h2>
      <p className="muted">Every job and task where <strong>you</strong> are in the People list — across all companies and boards.</p>
      {sections.length === 0 && (
        <div className="my-work-empty">🎉 Nothing on your plate — you'll see any job or task here as soon as someone puts you in its People column.</div>
      )}
      {sections.map(s => (
        <section key={s.company} className="my-work-section">
          <h3>🏛️ {s.company} <span className="muted">({s.items.length})</span>
            {s.overdue > 0 && <span className="mw-overdue-badge">🔴 {s.overdue} overdue</span>}</h3>
          {s.items.map(i => (
            <button key={i.id} className="my-work-row"
              onClick={() => { openBoard(i.board_id); openItem(i.id) }}>
              <span className="mw-boardcol">
                <span className="mw-board">{i.board.icon} {i.board.name}</span>
                {i.board.company_name && <span className="mw-company">{i.board.company_name}</span>}
              </span>
              <span className="mw-name">{i.parent_name ? <><span className="muted">{i.parent_name} ↳ </span>{i.name}</> : i.name}</span>
              {i.status && <span className="chip" style={{ background: i.status.color }}>{i.status.label}</span>}
              {i.due && <span className={`mw-date ${dueClass(i.due)}`}>{fmtDate(i.due)}</span>}
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}
