import React, { useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import Cell from './Cell'
import { Popover } from './ui'

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

export default function TableView({ items }) {
  const { boardData, users, refreshBoard, openItem, showToast } = useStore()
  const { board, groups, columns } = boardData

  async function act(promise) {
    try { await promise; await refreshBoard() } catch (e) { showToast(e.message) }
  }

  const setValue = (item, col, value) =>
    act(api.put(`/api/items/${item.id}/values/${col.id}`, { value }))
  const updateColumnSettings = (col, settings) =>
    act(api.put(`/api/columns/${col.id}`, { settings }))

  return (
    <div className="table-view">
      {groups.map(group => (
        <GroupTable key={group.id} group={group} columns={columns} users={users}
          items={items.filter(i => i.group_id === group.id)}
          groups={groups} board={board}
          act={act} setValue={setValue} updateColumnSettings={updateColumnSettings}
          openItem={openItem} />
      ))}
      <AddGroupButton board={board} act={act} />
    </div>
  )
}

function GroupTable({ group, groups, columns, items, users, board, act, setValue, updateColumnSettings, openItem }) {
  const [newItem, setNewItem] = useState('')
  const [editingName, setEditingName] = useState(false)

  async function addItem(e) {
    e.preventDefault()
    const name = newItem.trim()
    if (!name) return
    setNewItem('')
    await act(api.post(`/api/boards/${board.id}/items`, { name, group_id: group.id }))
  }

  return (
    <div className="group-table" style={{ '--group-color': group.color }}>
      <div className="group-head">
        <button className="group-collapse" onClick={() => act(api.put(`/api/groups/${group.id}`, { collapsed: !group.collapsed }))}>
          {group.collapsed ? '▸' : '▾'}
        </button>
        {editingName ? (
          <input className="group-name-input" autoFocus defaultValue={group.name}
            onBlur={e => { setEditingName(false); const v = e.target.value.trim(); if (v && v !== group.name) act(api.put(`/api/groups/${group.id}`, { name: v })) }}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingName(false) }} />
        ) : (
          <span className="group-name" style={{ color: group.color }} onClick={() => setEditingName(true)}>
            {group.name}
          </span>
        )}
        <span className="group-count">{items.length} item{items.length === 1 ? '' : 's'}</span>
        <GroupMenu group={group} act={act} />
      </div>

      {!group.collapsed && (
        <div className="table-scroll">
          <table className="board-table">
            <thead>
              <tr>
                <th className="col-name">Item</th>
                {columns.map(col => (
                  <ColumnHeader key={col.id} col={col} act={act} />
                ))}
                <th className="col-add"><AddColumnButton board={board} act={act} /></th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className="item-row">
                  <td className="col-name">
                    <div className="item-name-cell">
                      <ItemName item={item} act={act} />
                      <button className="open-btn" onClick={() => openItem(item.id)}>
                        Open {item.updates_count > 0 && <span className="bubble">💬 {item.updates_count}</span>}
                      </button>
                      <ItemMenu item={item} groups={groups} act={act} />
                    </div>
                  </td>
                  {columns.map(col => (
                    <td key={col.id} style={{ width: col.width, minWidth: col.width }}>
                      <Cell column={col} value={item.values[String(col.id)]} users={users}
                        onChange={v => setValue(item, col, v)}
                        onUpdateColumn={s => updateColumnSettings(col, s)} />
                    </td>
                  ))}
                  <td className="col-add" />
                </tr>
              ))}
              <tr className="add-item-row">
                <td className="col-name" colSpan={columns.length + 2}>
                  <form onSubmit={addItem}>
                    <input placeholder="＋ Add item" value={newItem}
                      onChange={e => setNewItem(e.target.value)} />
                  </form>
                </td>
              </tr>
              {items.length > 0 && (
                <tr className="group-footer">
                  <td className="col-name" />
                  {columns.map(col => (
                    <td key={col.id}>
                      {(col.type === 'status' || col.type === 'priority') &&
                        <DistributionBar column={col} items={items} />}
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

function ItemName({ item, act }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <input className="cell-input item-name-input" autoFocus defaultValue={item.name}
        onBlur={e => { setEditing(false); const v = e.target.value.trim(); if (v && v !== item.name) act(api.put(`/api/items/${item.id}`, { name: v })) }}
        onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditing(false) }} />
    )
  }
  return <span className="item-name" onClick={() => setEditing(true)} title="Click to rename">{item.name}</span>
}

function ItemMenu({ item, groups, act }) {
  const [open, setOpen] = useState(false)
  const others = groups.filter(g => g.id !== item.group_id)
  return (
    <div className="item-menu">
      <button className="icon-btn row-menu-btn" onClick={() => setOpen(true)}>⋯</button>
      {open && (
        <Popover onClose={() => setOpen(false)} width={200}>
          {others.map(g => (
            <button key={g.id} className="menu-item"
              onClick={() => { setOpen(false); act(api.put(`/api/items/${item.id}`, { group_id: g.id })) }}>
              ➡️ Move to <span style={{ color: g.color, fontWeight: 600 }}>{g.name}</span>
            </button>
          ))}
          {others.length > 0 && <hr className="menu-sep" />}
          <button className="menu-item menu-danger"
            onClick={() => { setOpen(false); if (confirm(`Delete "${item.name}"?`)) act(api.del(`/api/items/${item.id}`)) }}>
            🗑️ Delete item
          </button>
        </Popover>
      )}
    </div>
  )
}

function ColumnHeader({ col, act }) {
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  return (
    <th style={{ width: col.width, minWidth: col.width }}>
      <div className="col-head">
        {renaming ? (
          <input autoFocus defaultValue={col.title} className="col-rename"
            onBlur={e => { setRenaming(false); const v = e.target.value.trim(); if (v && v !== col.title) act(api.put(`/api/columns/${col.id}`, { title: v })) }}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setRenaming(false) }} />
        ) : (
          <span onDoubleClick={() => setRenaming(true)}>{col.title}</span>
        )}
        <button className="col-menu-btn" onClick={() => setMenu(true)}>⋯</button>
        {menu && (
          <Popover onClose={() => setMenu(false)} width={180}>
            <button className="menu-item" onClick={() => { setMenu(false); setRenaming(true) }}>✏️ Rename</button>
            <button className="menu-item menu-danger"
              onClick={() => { setMenu(false); if (confirm(`Delete column "${col.title}" and all its values?`)) act(api.del(`/api/columns/${col.id}`)) }}>
              🗑️ Delete column
            </button>
          </Popover>
        )}
      </div>
    </th>
  )
}

function AddColumnButton({ board, act }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="add-col">
      <button className="icon-btn" title="Add column" onClick={() => setOpen(true)}>＋</button>
      {open && (
        <Popover onClose={() => setOpen(false)} align="right" width={200}>
          {COLUMN_TYPES.map(ct => (
            <button key={ct.type} className="menu-item"
              onClick={() => { setOpen(false); act(api.post(`/api/boards/${board.id}/columns`, { type: ct.type, title: ct.label === 'Dropdown / Tags' ? 'Tags' : ct.label })) }}>
              {ct.icon} {ct.label}
            </button>
          ))}
        </Popover>
      )}
    </div>
  )
}

function GroupMenu({ group, act }) {
  const [open, setOpen] = useState(false)
  const colors = ['#579bfc', '#00c875', '#a25ddc', '#fdab3d', '#e2445c', '#66ccff', '#ff642e']
  return (
    <div className="group-menu">
      <button className="icon-btn" onClick={() => setOpen(true)}>⋯</button>
      {open && (
        <Popover onClose={() => setOpen(false)} width={190}>
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
        </Popover>
      )}
    </div>
  )
}

function AddGroupButton({ board, act }) {
  return (
    <button className="add-group-btn"
      onClick={() => act(api.post(`/api/boards/${board.id}/groups`, { name: 'New Group' }))}>
      ＋ Add new group
    </button>
  )
}
