import React, { useEffect } from 'react'
import { useStore, connectEvents, disconnectEvents } from './store'
import Login from './views/Login'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import HomeView from './views/HomeView'
import BoardView from './views/BoardView'
import MyWork from './views/MyWork'
import AdminUsers from './views/AdminUsers'
import ItemPanel from './components/ItemPanel'

export default function App() {
  const { authChecked, user, route, init, toast, panelItemId } = useStore()

  useEffect(() => { init() }, [])
  useEffect(() => {
    if (user) { connectEvents(); return () => disconnectEvents() }
  }, [user?.id])

  if (!authChecked) return <div className="app-loading">Loading…</div>
  if (!user) return <Login />

  return (
    <div className="app">
      <Sidebar />
      <div className="app-main">
        <TopBar />
        <div className="app-content">
          {route.page === 'home' && <HomeView />}
          {route.page === 'board' && <BoardView key={route.boardId} />}
          {route.page === 'mywork' && <MyWork />}
          {route.page === 'admin' && <AdminUsers />}
        </div>
      </div>
      {panelItemId && <ItemPanel itemId={panelItemId} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
