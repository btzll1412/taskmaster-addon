import React, { useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { AvatarStack, fmtDate, dueClass } from './ui'

/** Kanban view: lanes come from the labels of a status-type column. */
export default function KanbanView({ items, canEdit, usersFor }) {
  items = items.filter(i => !i.parent_id)
  const { boardData, users, refreshBoard, openItem, showToast } = useStore()
  const { board, columns } = boardData
  const statusCols = columns.filter(c => c.type === 'status' || c.type === 'priority')
  const [colId, setColId] = useState(() => {
    const saved = Number(localStorage.getItem(`tm-kanban-col-${board.id}`))
    return statusCols.find(c => c.id === saved) ? saved : statusCols[0]?.id
  })
  const [dragOver, setDragOver] = useState(null)
  const kanbanCol = statusCols.find(c => c.id === colId)

  if (!kanbanCol) {
    return <div className="kanban-empty">Add a Status column to use the Kanban view.</div>
  }

  const labels = kanbanCol.settings?.labels || []
  const lanes = [...labels.map(l => ({ ...l })), { id: null, label: 'No status', color: '#c4c4c4' }]

  function laneItems(laneId) {
    return items.filter(i => {
      const v = i.values[String(kanbanCol.id)]
      return (v?.id || null) === laneId
    })
  }

  async function drop(e, laneId) {
    e.preventDefault()
    setDragOver(null)
    const itemId = Number(e.dataTransfer.getData('text/item-id'))
    if (!itemId) return
    try {
      await api.put(`/api/items/${itemId}/values/${kanbanCol.id}`, { value: laneId ? { id: laneId } : null })
      await refreshBoard()
    } catch (err) { showToast(err.message) }
  }

  const peopleCol = columns.find(c => c.type === 'people')
  const dateCol = columns.find(c => c.type === 'date')
  const prioCol = columns.find(c => c.type === 'priority' && c.id !== kanbanCol.id)

  return (
    <div className="kanban">
      {statusCols.length > 1 && (
        <div className="kanban-toolbar">
          <label>Group by</label>
          <select value={colId} onChange={e => {
            const v = Number(e.target.value); setColId(v)
            localStorage.setItem(`tm-kanban-col-${board.id}`, String(v))
          }}>
            {statusCols.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </div>
      )}
      <div className="kanban-lanes">
        {lanes.map(lane => {
          const laneList = laneItems(lane.id)
          if (lane.id === null && laneList.length === 0) return null
          return (
            <div key={lane.id ?? 'none'}
              className={`kanban-lane ${dragOver === (lane.id ?? 'none') ? 'drag-over' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(lane.id ?? 'none') }}
              onDragLeave={() => setDragOver(null)}
              onDrop={e => drop(e, lane.id)}>
              <div className="lane-head" style={{ background: lane.color }}>
                <span>{lane.label}</span>
                <span className="lane-count">{laneList.length}</span>
              </div>
              <div className="lane-cards">
                {laneList.map(item => (
                  <KanbanCard key={item.id} item={item} users={usersFor ? usersFor(item) : users} laneColor={lane.color}
                    peopleCol={peopleCol} dateCol={dateCol} prioCol={prioCol}
                    onOpen={() => openItem(item.id)} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function KanbanCard({ item, users, laneColor, peopleCol, dateCol, prioCol, onOpen }) {
  const people = peopleCol ? (item.values[String(peopleCol.id)]?.user_ids || []) : []
  const assignees = users.filter(u => people.includes(u.id))
  const date = dateCol ? item.values[String(dateCol.id)]?.date : null
  const prio = prioCol
    ? (prioCol.settings?.labels || []).find(l => l.id === item.values[String(prioCol.id)]?.id)
    : null

  return (
    <div className="kanban-card" style={{ '--lane-color': laneColor }} draggable
      onDragStart={e => e.dataTransfer.setData('text/item-id', String(item.id))}
      onClick={onOpen}>
      <div className="card-name">{item.name}</div>
      <div className="card-meta">
        {prio && <span className="chip" style={{ background: prio.color }}>{prio.label}</span>}
        {date && <span className={`card-date ${dueClass(date)}`}>📅 {fmtDate(date)}</span>}
        {item.updates_count > 0 && <span className="card-updates">💬 {item.updates_count}</span>}
        <span className="card-spacer" />
        {assignees.length > 0 && <AvatarStack users={assignees} size={22} />}
      </div>
    </div>
  )
}
