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

    const today = new Date(); today.setHours(0, 0, 0, 0)
    const week = new Date(today); week.setDate(week.getDate() + 7)
    const buckets = { overdue: [], today: [], week: [], later: [], nodate: [], done: [] }
    for (const i of items) {
      if (i.status?.label?.toLowerCase() === 'done') { buckets.done.push(i); continue }
      if (!i.due) { buckets.nodate.push(i); continue }
      const d = new Date(i.due + 'T00:00:00')
      if (d < today) buckets.overdue.push(i)
      else if (d.getTime() === today.getTime()) buckets.today.push(i)
      else if (d <= week) buckets.week.push(i)
      else buckets.later.push(i)
    }
    for (const k of Object.keys(buckets)) buckets[k].sort((a, b) => (a.due || '9999') < (b.due || '9999') ? -1 : 1)
    return [
      { key: 'overdue', title: '🔴 Overdue', items: buckets.overdue },
      { key: 'today', title: '⭐ Today', items: buckets.today },
      { key: 'week', title: '📆 This week', items: buckets.week },
      { key: 'later', title: '⏳ Later', items: buckets.later },
      { key: 'nodate', title: '🗓 No due date', items: buckets.nodate },
      { key: 'done', title: '✅ Done', items: buckets.done },
    ].filter(s => s.items.length > 0)
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
        <section key={s.key} className="my-work-section">
          <h3>{s.title} <span className="muted">({s.items.length})</span></h3>
          {s.items.map(i => (
            <button key={i.id} className="my-work-row"
              onClick={() => { openBoard(i.board_id); openItem(i.id) }}>
              <span className="mw-board">{i.board.icon} {i.board.name}</span>
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
