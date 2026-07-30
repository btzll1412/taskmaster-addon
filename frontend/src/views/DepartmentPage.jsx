import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { Modal } from '../components/ui'
import { NewBoardForm } from './CompanyPage'

export default function DepartmentPage() {
  const { user, route, navigate, openBoard, refreshBoards, showToast } = useStore()
  const [data, setData] = useState(null)
  const [newBoard, setNewBoard] = useState(false)

  async function load() {
    try { setData(await api.get(`/api/departments/${route.deptId}`)) }
    catch (e) { showToast(e.message); navigate({ page: 'home' }) }
  }
  useEffect(() => { load() }, [route.deptId])

  if (!data) return <div className="muted page-loading">Loading…</div>
  const { department, company, boards, can_manage, can_create_board } = data
  const cap = (c) => (user.capabilities || []).includes(c)
  const canAddJob = cap('create_jobs') &&
    (boards.some(b => b.access === 'full' && !b.archived) || can_create_board)

  async function quickAddJob() {
    try {
      let board = boards.find(b => b.access === 'full' && !b.archived)
      if (!board) {
        const created = await api.post(`/api/departments/${department.id}/boards`, { name: 'Jobs', icon: '🧰' })
        board = created.board
        await refreshBoards()
      }
      navigate({ page: 'board', boardId: board.id, newJob: true })
    } catch (e) { showToast(e.message) }
  }

  return (
    <div className="entity-page">
      <div className="breadcrumb">
        <button className="link-btn" onClick={() => navigate({ page: 'company', companyId: company.id })}>
          🏛️ {company.name}
        </button>
        <span className="crumb-sep">/</span>
        <span>{department.icon} {department.name}</span>
      </div>
      <div className="entity-head">
        <h2>{department.icon} {department.name}</h2>
        <div className="entity-actions">
          {can_create_board && <button className="btn btn-secondary" onClick={() => setNewBoard(true)}>＋ Job board</button>}
          {canAddJob && <button className="btn btn-primary" onClick={quickAddJob}>＋ Add job</button>}
          {can_manage && (
            <button className="btn btn-danger" title="Delete this department (boards must be removed first)"
              onClick={async () => {
                if (!confirm(`Delete department "${department.name}"?\n\nIts boards must be deleted first. This is logged in the audit log.`)) return
                try {
                  await api.del(`/api/departments/${department.id}`)
                  await refreshBoards()
                  navigate({ page: 'company', companyId: company.id })
                } catch (e) { showToast(e.message) }
              }}>🗑️ Delete</button>
          )}
        </div>
      </div>

      <section className="entity-section">
        <h3>Job boards</h3>
        <div className="board-cards">
          {boards.filter(b => !b.archived).map(b => (
            <button key={b.id} className="board-card" onClick={() => openBoard(b.id)}>
              <span className="board-card-icon">{b.icon}</span>
              <span className="board-card-name">{b.name}</span>
              {b.access === 'partial' && <span className="muted">🔒 limited</span>}
            </button>
          ))}
          {boards.filter(b => !b.archived).length === 0 && (
            <span className="muted">
              {can_create_board ? 'No job boards yet — use ＋ Job board above.' : 'No boards shared with you here.'}
            </span>
          )}
        </div>
      </section>

      {newBoard && (
        <Modal title={`New job board — ${department.name}`} onClose={() => setNewBoard(false)}>
          <NewBoardForm onSubmit={async (name, icon) => {
            const created = await api.post(`/api/departments/${department.id}/boards`, { name, icon })
            setNewBoard(false); await refreshBoards(); openBoard(created.board.id)
          }} showToast={showToast} />
        </Modal>
      )}
    </div>
  )
}
