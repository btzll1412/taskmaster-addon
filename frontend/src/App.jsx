import React, { useEffect } from 'react'
import { useStore, connectEvents, disconnectEvents, connectHistory } from './store'
import Login from './views/Login'
import ForcePasswordChange from './views/ForcePasswordChange'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import HomeView from './views/HomeView'
import BoardView from './views/BoardView'
import MyWork from './views/MyWork'
import AdminUsers from './views/AdminUsers'
import CompanyPage from './views/CompanyPage'
import DepartmentPage from './views/DepartmentPage'
import { DepartmentsDirectory, ItemsDirectory } from './views/Directory'
import Settings from './views/Settings'
import CompaniesDirectory from './views/CompaniesDirectory'
import TemplatesPage from './views/TemplatesPage'
import ItemPanel from './components/ItemPanel'

export default function App() {
  const { authChecked, user, pendingUser, route, init, toast, panelItemId } = useStore()

  useEffect(() => { init() }, [])
  useEffect(() => {
    if (user && !user.must_change_password) {
      connectEvents(); connectHistory()
      return () => disconnectEvents()
    }
  }, [user?.id, user?.must_change_password])

  if (!authChecked) return <div className="app-loading">Loading…</div>
  if (!user) return pendingUser ? <ForcePasswordChange /> : <Login />

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
          {route.page === 'company' && <CompanyPage key={route.companyId} />}
          {route.page === 'department' && <DepartmentPage key={route.deptId} />}
          {route.page === 'departments' && <DepartmentsDirectory />}
          {route.page === 'jobs' && <ItemsDirectory kind="jobs" key="jobs" />}
          {route.page === 'tasks' && <ItemsDirectory kind="tasks" key="tasks" />}
          {route.page === 'settings' && <Settings />}
          {route.page === 'companies' && <CompaniesDirectory />}
          {route.page === 'templates' && <TemplatesPage />}
        </div>
      </div>
      {panelItemId && <ItemPanel itemId={panelItemId} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
