import React, { useRef, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import Cell from './Cell'
import { OverlayPopover } from './ui'

// HTML5 drag doesn't work by touch, but the draggable attribute makes some
// mobile browsers hesitate on taps — so only enable it for mouse users.
const TOUCH_SCREEN = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

const COLUMN_TYPES = [
  { type: 'status', label: 'Status', icon: '🟢' },
  { type: 'priority', label: 'Priority', icon: '🚩' },
  { type: 'text', label: 'Text', icon: '🔤' },
  { type: 'people', label: 'People', icon: '👥' },
  { type: 'date', label: 'Date', icon: '📅' },
  { type: 'number', label: 'Number', icon: '#️⃣' },
  { type: 'dropdown', label: 'Dropdown / Tags', icon: '🏷️' },
  { type: 'checkbox', label: 'Checkbox', icon: '☑️' },
]

export default function TableView({ items, canEdit, canCreate, canEditItems, canReorder, usersFor }) {
  const { boardData, users, refreshBoard, openItem, showToast } = useStore()
  const { board, groups, columns } = boardData
  const [widths, setWidths] = useState({})   // live drag-resize overrides
  const colWidth = (col) => widths[col.id] ?? col.width

  function startResize(col, e) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = colWidth(col)
    const clamp = (w) => Math.max(70, Math.min(600, Math.round(w)))
    const move = (ev) => setWidths(prev => ({ ...prev, [col.id]: clamp(startW + ev.clientX - startX) }))
    const up = async (ev) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('resizing-col')
      const w = clamp(startW + ev.clientX - startX)
      if (w !== col.width) {
        try { await api.put(`/api/columns/${col.id}`, { width: w }); await refreshBoard() }
        catch (err) { showToast(err.message) }
      }
    }
    document.body.classList.add('resizing-col')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  async function act(promise) {
    try { await promise; await refreshBoard() } catch (e) { showToast(e.message) }
  }

  const setValue = (item, col, value) =>
    act(api.put(`/api/items/${item.id}/values/${col.id}`, { value }))
  const updateColumnSettings = canEdit
    ? (col, settings) => act(api.put(`/api/columns/${col.id}`, { settings }))
    : null

  return (
    <div className="table-view">
      {groups.map(group => (
        <GroupTable key={group.id} group={group} columns={columns} users={users}
          usersFor={usersFor} canCreate={canCreate} canEditItems={canEditItems}
          items={items.filter(i => i.group_id === group.id)}
          groups={groups} board={board} canEdit={canEdit}
          act={act} setValue={setValue} updateColumnSettings={updateColumnSettings}
          openItem={openItem} colWidth={colWidth} startResize={startResize}
          canReorder={canReorder} />
      ))}
      {canEdit && (
        <button className="add-group-btn"
          onClick={() => act(api.post(`/api/boards/${board.id}/groups`, { name: 'New Group' }))}>
          ＋ Add new group
        </button>
      )}
    </div>
  )
}

function GroupTable({ group, groups, columns, items, users, usersFor, board, canEdit,
  canCreate, canEditItems, canReorder, act, setValue, updateColumnSettings, openItem, colWidth, startResize }) {
  const [newItem, setNewItem] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set())
  const [dragId, setDragId] = useState(null)
  const dragRef = useRef(null)

  async function dropOn(target) {
    const dragging = dragRef.current
    dragRef.current = null
    if (!dragging || dragging === target.id) { setDragId(null); return }
    const tops = items.filter(i => !i.parent_id)
    const from = tops.findIndex(i => i.id === dragging)
    const to = tops.findIndex(i => i.id === target.id)
    if (from < 0 || to < 0) { setDragId(null); return }
    const before = to > from ? tops[to] : tops[to - 1]
    const after = to > from ? tops[to + 1] : tops[to]
    let pos
    if (!before) pos = (after?.position ?? 1) - 1
    else if (!after) pos = before.position + 1
    else pos = (before.position + after.position) / 2
    setDragId(null)
    await act(api.put(`/api/items/${dragging}`, { position: pos }))
  }

  const topItems = items.filter(i => !i.parent_id)
  const subsByParent = {}
  for (const i of items) {
    if (i.parent_id) (subsByParent[i.parent_id] = subsByParent[i.parent_id] || []).push(i)
  }

  function toggleExpand(id) {
    const next = new Set(expanded)
    next.has(id) ? next.delete(id) : next.add(id)
    setExpanded(next)
  }

  async function addItem(e) {
    e.preventDefault()
    const name = newItem.trim()
    if (!name) return
    setNewItem('')
    await act(api.post(`/api/boards/${board.id}/items`, { name, group_id: group.id }))
  }

  const colSpan = columns.length + 2

  return (
    <div className="group-table" style={{ '--group-color': group.color }}>
      <div className="group-head">
        <button className="group-collapse"
          onClick={() => canEdit && act(api.put(`/api/groups/${group.id}`, { collapsed: !group.collapsed }))}>
          {group.collapsed ? '▸' : '▾'}
        </button>
        {editingName && canEdit ? (
          <input className="group-name-input" autoFocus defaultValue={group.name}
            onBlur={e => { setEditingName(false); const v = e.target.value.trim(); if (v && v !== group.name) act(api.put(`/api/groups/${group.id}`, { name: v })) }}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingName(false) }} />
        ) : (
          <span className="group-name" style={{ color: group.color }}
            onClick={() => canEdit && setEditingName(true)}>
            {group.name}
          </span>
        )}
        <span className="group-count">{topItems.length} item{topItems.length === 1 ? '' : 's'}</span>
        {canEdit && <GroupMenu group={group} act={act} />}
      </div>

      {!group.collapsed && (
        <div className="table-scroll">
          <table className="board-table">
            <thead>
              <tr>
                <th className="col-name">Item</th>
                {columns.map(col => (
                  <ColumnHeader key={col.id} col={col} act={act} canEdit={canEdit}
                    width={colWidth(col)} startResize={startResize} />
                ))}
                <th className="col-add">{canEdit && <AddColumnButton board={board} act={act} />}</th>
              </tr>
            </thead>
            <tbody>
              {topItems.map(item => (
                <React.Fragment key={item.id}>
                  <ItemRow item={item} columns={columns} users={usersFor ? usersFor(item) : users} groups={groups}
                    canEdit={canEdit} canEditItems={canEditItems} act={act} setValue={setValue}
                    updateColumnSettings={updateColumnSettings} openItem={openItem} colWidth={colWidth}
                    subCount={(subsByParent[item.id] || []).length}
                    isExpanded={expanded.has(item.id)}
                    onToggleExpand={() => toggleExpand(item.id)}
                    draggable={canReorder && !TOUCH_SCREEN}
                    onDragStart={() => { dragRef.current = item.id; setDragId(item.id) }}
                    onDropRow={() => dropOn(item)}
                    isDragging={dragId === item.id} />
                  {expanded.has(item.id) && (
                    <>
                      {(subsByParent[item.id] || []).map(sub => (
                        <ItemRow key={sub.id} item={sub} columns={columns} users={usersFor ? usersFor(sub) : users}
                          groups={groups} canEdit={canEdit} canEditItems={canEditItems}
                          act={act} setValue={setValue}
                          updateColumnSettings={updateColumnSettings} openItem={openItem}
                          colWidth={colWidth} isSub />
                      ))}
                      {canCreate && (
                        <tr className="add-item-row sub-row">
                          <td colSpan={colSpan}>
                            <AddSubItem board={board} parent={item} act={act} />
                          </td>
                        </tr>
                      )}
                    </>
                  )}
                </React.Fragment>
              ))}
              {canCreate && (
                <tr className="add-item-row">
                  <td className="col-name" colSpan={colSpan}>
                    <form onSubmit={addItem}>
                      <input placeholder="＋ Add item" value={newItem}
                        onChange={e => setNewItem(e.target.value)} />
                    </form>
                  </td>
                </tr>
              )}
              {topItems.length > 0 && (
                <tr className="group-footer">
                  <td className="col-name" />
                  {columns.map(col => (
                    <td key={col.id}>
                      {(col.type === 'status' || col.type === 'priority') &&
                        <DistributionBar column={col} items={topItems} />}
                    </td>
                  ))}
                  <td className="col-add" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ItemRow({ item, columns, users, groups, canEdit, canEditItems, act, setValue,
  updateColumnSettings, openItem, colWidth, isSub, subCount = 0, isExpanded, onToggleExpand,
  draggable, onDragStart, onDropRow, isDragging }) {
  return (
    <tr className={`item-row ${isSub ? 'sub-item-row' : ''} ${isDragging ? 'row-dragging' : ''}`}
      draggable={!!draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragOver={draggable ? (e) => e.preventDefault() : undefined}
      onDrop={draggable ? (e) => { e.preventDefault(); onDropRow() } : undefined}>
      <td className="col-name">
        <div className="item-name-cell">
          {isSub && <span className="sub-indent">↳</span>}
          {!isSub && (
            <button className={`expander ${subCount > 0 ? 'expander-subs' : 'expander-empty'}`}
              title={subCount > 0 ? `${subCount} sub-task${subCount === 1 ? '' : 's'}` : 'Add sub-tasks'}
              onClick={onToggleExpand}>
              {isExpanded ? '▾' : subCount > 0 ? `▸${subCount}` : '▸'}
            </button>
          )}
          <span className="item-name" title="Open" onClick={() => openItem(item.id)}>
            {item.name}
            {item.updates_count > 0 && <span className="bubble"> 💬 {item.updates_count}</span>}
          </span>
          <ItemMenu item={item} groups={groups} act={act} canEdit={canEdit} isSub={isSub}
            canEditItems={canEditItems} columns={columns} setValue={setValue} />
        </div>
      </td>
      {columns.map(col => (
        <td key={col.id} style={{ width: colWidth ? colWidth(col) : col.width, minWidth: colWidth ? colWidth(col) : col.width }}>
          <Cell column={col} value={item.values[String(col.id)]} users={users}
            disabled={!canEditItems}
            onChange={v => setValue(item, col, v)}
            onUpdateColumn={updateColumnSettings ? (s => updateColumnSettings(col, s)) : undefined} />
        </td>
      ))}
      <td className="col-add" />
    </tr>
  )
}

function AddSubItem({ board, parent, act }) {
  const [name, setName] = useState('')
  return (
    <form className="add-sub-form" onSubmit={async (e) => {
      e.preventDefault()
      const v = name.trim()
      if (!v) return
      setName('')
      await act(api.post(`/api/boards/${board.id}/items`, { name: v, parent_id: parent.id }))
    }}>
      <input placeholder={`＋ Add sub-task to "${parent.name}"`} value={name}
        onChange={e => setName(e.target.value)} />
    </form>
  )
}

function ItemMenu({ item, groups, act, canEdit, isSub, canEditItems, columns, setValue }) {
  const [open, setOpen] = useState(false)
  const anchor = useRef(null)
  const others = canEdit && !isSub ? groups.filter(g => g.id !== item.group_id) : []
  // quick status: every label this board's status column has
  const statusCol = (columns || []).find(c => c.type === 'status')
  const labels = statusCol?.settings?.labels || []
  const currentId = statusCol ? item.values?.[String(statusCol.id)]?.id : null
  return (
    <div className="item-menu" ref={anchor}>
      <button className="icon-btn row-menu-btn" onClick={() => setOpen(true)}>⋯</button>
      {open && (
        <OverlayPopover anchorRef={anchor} onClose={() => setOpen(false)} width={210}>
          {canEditItems && statusCol && labels.length > 0 && (
            <>
              <div className="menu-label muted">Set status</div>
              {labels.map(l => (
                <button key={l.id} className="label-option" style={{ background: l.color }}
                  onClick={() => { setOpen(false); setValue(item, statusCol, { id: l.id }) }}>
                  {l.label}{currentId === l.id ? ' ✓' : ''}
                </button>
              ))}
              {currentId && (
                <button className="label-option label-clear"
                  onClick={() => { setOpen(false); setValue(item, statusCol, null) }}>
                  Clear status
                </button>
              )}
              <hr className="menu-sep" />
            </>
          )}
          {others.map(g => (
            <button key={g.id} className="menu-item"
              onClick={() => { setOpen(false); act(api.put(`/api/items/${item.id}`, { group_id: g.id })) }}>
              ➡️ Move to <span style={{ color: g.color, fontWeight: 600 }}>{g.name}</span>
            </button>
          ))}
          {others.length > 0 && <hr className="menu-sep" />}
          <button className="menu-item menu-danger"
            onClick={() => { setOpen(false); if (confirm(`Delete "${item.name}"?`)) act(api.del(`/api/items/${item.id}`)) }}>
            🗑️ Delete {isSub ? 'sub-task' : 'item'}
          </button>
        </OverlayPopover>
      )}
    </div>
  )
}

function ColumnHeader({ col, act, canEdit, width, startResize }) {
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const anchor = useRef(null)
  const w = width ?? col.width
  return (
    <th style={{ width: w, minWidth: w }}>
      <div className="col-head" ref={anchor}>
        {renaming && canEdit ? (
          <input autoFocus defaultValue={col.title} className="col-rename"
            onBlur={e => { setRenaming(false); const v = e.target.value.trim(); if (v && v !== col.title) act(api.put(`/api/columns/${col.id}`, { title: v })) }}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setRenaming(false) }} />
        ) : (
          <span onDoubleClick={() => canEdit && setRenaming(true)}>{col.title}</span>
        )}
        {canEdit && <button className="col-menu-btn" onClick={() => setMenu(true)}>⋯</button>}
        {menu && (
          <OverlayPopover anchorRef={anchor} onClose={() => setMenu(false)} width={190}>
            <button className="menu-item" onClick={() => { setMenu(false); setRenaming(true) }}>✏️ Rename</button>
            <button className="menu-item menu-danger"
              onClick={() => { setMenu(false); if (confirm(`Delete column "${col.title}" and all its values?`)) act(api.del(`/api/columns/${col.id}`)) }}>
              🗑️ Delete column
            </button>
          </OverlayPopover>
        )}
      </div>
      {canEdit && startResize && (
        <div className="col-resizer" title="Drag to resize"
          onPointerDown={e => startResize(col, e)} />
      )}
    </th>
  )
}

function AddColumnButton({ board, act }) {
  const [open, setOpen] = useState(false)
  const anchor = useRef(null)
  return (
    <div className="add-col" ref={anchor}>
      <button className="icon-btn" title="Add column" onClick={() => setOpen(true)}>＋</button>
      {open && (
        <OverlayPopover anchorRef={anchor} onClose={() => setOpen(false)} width={210}>
          {COLUMN_TYPES.map(ct => (
            <button key={ct.type} className="menu-item"
              onClick={() => { setOpen(false); act(api.post(`/api/boards/${board.id}/columns`, { type: ct.type, title: ct.label === 'Dropdown / Tags' ? 'Tags' : ct.label })) }}>
              {ct.icon} {ct.label}
            </button>
          ))}
        </OverlayPopover>
      )}
    </div>
  )
}

function GroupMenu({ group, act }) {
  const [open, setOpen] = useState(false)
  const anchor = useRef(null)
  const colors = ['#579bfc', '#00c875', '#a25ddc', '#fdab3d', '#e2445c', '#66ccff', '#ff642e']
  return (
    <div className="group-menu" ref={anchor}>
      <button className="icon-btn" onClick={() => setOpen(true)}>⋯</button>
      {open && (
        <OverlayPopover anchorRef={anchor} onClose={() => setOpen(false)} width={200}>
          <div className="color-row">
            {colors.map(c => (
              <button key={c} className="color-dot" style={{ background: c }}
                onClick={() => { act(api.put(`/api/groups/${group.id}`, { color: c })); setOpen(false) }} />
            ))}
          </div>
          <button className="menu-item menu-danger"
            onClick={() => { setOpen(false); if (confirm(`Delete group "${group.name}" and all its items?`)) act(api.del(`/api/groups/${group.id}`)) }}>
            🗑️ Delete group
          </button>
        </OverlayPopover>
      )}
    </div>
  )
}

/** monday-style "battery": proportional colored segments of label usage in a group. */
function DistributionBar({ column, items }) {
  const labels = column.settings?.labels || []
  const counts = new Map()
  for (const item of items) {
    const id = item.values[String(column.id)]?.id ?? null
    counts.set(id, (counts.get(id) || 0) + 1)
  }
  const segments = [
    ...labels.filter(l => counts.get(l.id)).map(l => ({ ...l, n: counts.get(l.id) })),
    ...(counts.get(null) ? [{ id: null, label: 'No status', color: '#c4c4c4', n: counts.get(null) }] : []),
  ]
  return (
    <div className="dist-bar">
      {segments.map(s => (
        <div key={s.id ?? 'none'} className="dist-seg" style={{ flex: s.n, background: s.color }}
          title={`${s.label} ${s.n}/${items.length}`} />
      ))}
    </div>
  )
}
