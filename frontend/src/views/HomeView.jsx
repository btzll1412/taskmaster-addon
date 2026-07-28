import React, { useEffect } from 'react'
import { useStore } from '../store'
import { Avatar, timeAgo } from '../components/ui'

export default function HomeView() {
  const { user, stats, boards, refreshStats, openBoard, openItem, navigate } = useStore()

  useEffect(() => { refreshStats() }, [])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const active = boards.filter(b => !b.archived)
  const ov = stats?.overview
  const isSuper = user.role === 'super_admin'
  const isAdmin = isSuper || user.role === 'company_admin'

  const cards = ov ? [
    ...(isSuper ? [{ icon: '🏛️', label: 'Companies', value: ov.companies, go: () => navigate({ page: 'admin', tab: 'companies' }) }] : []),
    { icon: '🏢', label: 'Departments', value: ov.departments },
    { icon: '📋', label: 'Jobs', value: ov.jobs },
    { icon: '🧩', label: 'Tasks', value: ov.tasks },
    { icon: '👥', label: 'Users', value: ov.users, go: isAdmin ? () => navigate({ page: 'admin', tab: 'users' }) : null },
  ] : []

  return (
    <div className="home-view">
      <h2 className="home-greeting">{greeting}, {user.display_name.split(' ')[0]}! 👋</h2>

      <div className="overview-cards">
        {cards.map(c => (
          <button key={c.label} className={`overview-card ${c.go ? 'clickable' : ''}`}
            onClick={c.go || undefined} disabled={!c.go}>
            <span className="overview-icon">{c.icon}</span>
            <span className="overview-num">{c.value}</span>
            <span className="overview-label">{c.label}</span>
          </button>
        ))}
      </div>

      <div className="home-columns">
        <section className="home-section">
          <h3>Your boards</h3>
          <div className="board-cards">
            {active.map(b => (
              <button key={b.id} className="board-card" onClick={() => openBoard(b.id)}>
                <span className="board-card-icon">{b.icon}</span>
                <span className="board-card-name">{b.name}</span>
                <span className="muted">{b.access === 'partial' ? '🔒 limited' : ''}</span>
              </button>
            ))}
            {active.length === 0 && (
              <div className="muted">No boards yet — create one from the sidebar to get started.</div>
            )}
          </div>
        </section>

        <section className="home-section">
          <h3>Recent activity</h3>
          <div className="activity-feed">
            {stats?.recent_activity?.map(a => {
              const actor = stats.activity_users[String(a.user_id)]
              return (
                <button key={a.id} className="activity-row activity-link" onClick={() => {
                  if (a.board_id) { openBoard(a.board_id); if (a.item_id) openItem(a.item_id) }
                }}>
                  <Avatar user={actor} size={26} />
                  <span className="activity-text">
                    <strong>{actor?.display_name || 'Someone'}</strong> {a.description}
                    {a.board_id && stats.board_names[String(a.board_id)] &&
                      <span className="muted"> · {stats.board_names[String(a.board_id)]}</span>}
                  </span>
                  <span className="muted activity-time">{timeAgo(a.created_at)}</span>
                </button>
              )
            })}
            {(!stats || stats.recent_activity.length === 0) &&
              <div className="muted">Nothing here yet.</div>}
          </div>
        </section>
      </div>
    </div>
  )
}
