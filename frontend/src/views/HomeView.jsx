import React, { useEffect } from 'react'
import { useStore } from '../store'
import { Avatar, timeAgo } from '../components/ui'

export default function HomeView() {
  const { user, stats, boards, refreshStats, openBoard, openItem } = useStore()

  useEffect(() => { refreshStats() }, [])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const active = boards.filter(b => !b.archived)

  return (
    <div className="home-view">
      <h2 className="home-greeting">{greeting}, {user.display_name.split(' ')[0]}! 👋</h2>

      {stats && (
        <div className="stat-tiles">
          <div className="stat-tile"><span className="stat-num">{stats.boards}</span><span className="stat-label">Boards</span></div>
          <div className="stat-tile"><span className="stat-num">{stats.items}</span><span className="stat-label">Items</span></div>
          <div className="stat-tile stat-done"><span className="stat-num">{stats.done}</span><span className="stat-label">Done</span></div>
          <div className="stat-tile"><span className="stat-num">{stats.users}</span><span className="stat-label">Teammates</span></div>
        </div>
      )}

      <div className="home-columns">
        <section className="home-section">
          <h3>Your boards</h3>
          <div className="board-cards">
            {active.map(b => (
              <button key={b.id} className="board-card" onClick={() => openBoard(b.id)}>
                <span className="board-card-icon">{b.icon}</span>
                <span className="board-card-name">{b.name}</span>
                <span className="muted">{b.items_count} item{b.items_count === 1 ? '' : 's'}</span>
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
