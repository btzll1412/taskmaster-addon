import React, { useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { Modal } from '../components/ui'
import { QuickNameForm } from './CompanyPage'

export default function CompaniesDirectory() {
  const { user, workspace, navigate, refreshBoards, showToast } = useStore()
  const [showNew, setShowNew] = useState(false)
  const isSuper = user.role === 'super_admin'

  return (
    <div className="entity-page">
      <div className="entity-head">
        <h2>🏛️ Companies</h2>
        {isSuper && <button className="btn btn-primary" onClick={() => setShowNew(true)}>＋ New company</button>}
      </div>

      {workspace.companies.length === 0 && (
        <p className="muted">No companies yet{isSuper ? ' — create your first one.' : '.'}</p>
      )}

      <div className="companies-grid">
        {workspace.companies.map(c => {
          const boards = (c.boards?.length || 0) +
            c.departments.reduce((n, d) => n + d.boards.length, 0)
          return (
            <button key={c.id} className="company-tile"
              onClick={() => navigate({ page: 'company', companyId: c.id })}>
              <div className="company-tile-head">
                <span className="company-tile-icon">🏛️</span>
                <strong>{c.name}</strong>
              </div>
              <div className="company-tile-meta muted">
                {c.contact_name && <span>👤 {c.contact_name}</span>}
                {c.phone && <span>📞 {c.phone}</span>}
                {c.address && <span>📍 {c.address.split('\n')[0]}</span>}
              </div>
              <div className="company-tile-counts muted">
                {c.departments.length} department{c.departments.length === 1 ? '' : 's'} · {boards} board{boards === 1 ? '' : 's'}
              </div>
            </button>
          )
        })}
      </div>

      {showNew && (
        <Modal title="Create company" onClose={() => setShowNew(false)}>
          <QuickNameForm placeholder="Company name" showToast={showToast}
            onSubmit={async (name) => {
              const created = await api.post('/api/companies', { name })
              setShowNew(false)
              await refreshBoards()
              navigate({ page: 'company', companyId: created.company.id })
            }} />
        </Modal>
      )}
    </div>
  )
}
