import { create } from 'zustand'
import { api } from './api'

export const useStore = create((set, get) => ({
  // auth
  authChecked: false,
  setupRequired: false,
  user: null,

  // data
  users: [],
  boards: [],
  workspace: { companies: [], can_create_companies: false },
  boardData: null, // { board, groups, columns, items }
  boardLoading: false,
  stats: null,
  myWork: null,
  notifications: [],
  unread: 0,

  // ui
  route: { page: 'home', boardId: null }, // home | board | mywork | admin
  panelItemId: null,
  toast: null,
  sidebarMobile: false,

  toggleSidebarMobile() { set(s => ({ sidebarMobile: !s.sidebarMobile })) },

  async init() {
    const st = await api.get('/api/auth/status')
    set({ authChecked: true, setupRequired: st.setup_required, user: st.user })
    if (st.user) await get().loadCore()
  },

  async loadCore() {
    const [users, boards, workspace] = await Promise.all([
      api.get('/api/users'),
      api.get('/api/boards'),
      api.get('/api/workspace'),
    ])
    set({ users: users.users, boards: boards.boards, workspace })
    get().refreshNotifications()
    const saved = localStorage.getItem('tm-route')
    if (saved) {
      try {
        const route = JSON.parse(saved)
        if (route.page === 'board' && !boards.boards.find(b => b.id === route.boardId)) {
          set({ route: { page: 'home', boardId: null } })
        } else {
          set({ route })
          if (route.page === 'board') get().openBoard(route.boardId, { keepRoute: true })
        }
      } catch { /* ignore */ }
    }
  },

  navigate(route) {
    set({ route, panelItemId: null, sidebarMobile: false })
    localStorage.setItem('tm-route', JSON.stringify(route))
    if (route.page === 'board') get().openBoard(route.boardId, { keepRoute: true })
    if (route.page === 'home') get().refreshStats()
    if (route.page === 'mywork') get().refreshMyWork()
  },

  async openBoard(boardId, { keepRoute } = {}) {
    if (!keepRoute) get().navigate({ page: 'board', boardId })
    set({ boardLoading: get().boardData?.board?.id !== boardId })
    try {
      const data = await api.get(`/api/boards/${boardId}`)
      // Ignore stale responses if the user already switched boards
      if (get().route.boardId === boardId) set({ boardData: data, boardLoading: false })
    } catch (e) {
      set({ boardLoading: false })
      get().showToast(e.message)
    }
  },

  async refreshBoard() {
    const id = get().route.page === 'board' ? get().route.boardId : null
    if (!id) return
    try {
      const data = await api.get(`/api/boards/${id}`)
      if (get().route.boardId === id) set({ boardData: data })
    } catch { /* board may have been deleted */ }
  },

  async refreshBoards() {
    const [boards, workspace] = await Promise.all([
      api.get('/api/boards'),
      api.get('/api/workspace'),
    ])
    set({ boards: boards.boards, workspace })
  },

  async refreshUsers() {
    const users = await api.get('/api/users')
    set({ users: users.users })
  },

  async refreshStats() {
    try { set({ stats: await api.get('/api/stats') }) } catch { /* ignore */ }
  },

  async refreshMyWork() {
    try { set({ myWork: await api.get('/api/my-work') }) } catch { /* ignore */ }
  },

  async refreshNotifications() {
    try {
      const d = await api.get('/api/notifications')
      set({ notifications: d.notifications, unread: d.unread })
    } catch { /* ignore */ }
  },

  showToast(message) {
    set({ toast: message })
    clearTimeout(get()._toastTimer)
    const timer = setTimeout(() => set({ toast: null }), 3500)
    set({ _toastTimer: timer })
  },

  openItem(itemId) { set({ panelItemId: itemId }) },
  closeItem() { set({ panelItemId: null }) },

  async logout() {
    await api.post('/api/auth/logout')
    localStorage.removeItem('tm-route')
    set({ user: null, boards: [], boardData: null, route: { page: 'home', boardId: null } })
  },
}))

// ---- Server-sent events: live updates ----
let es = null
export function connectEvents() {
  if (es) es.close()
  es = new EventSource('/api/events')
  es.onmessage = (msg) => {
    let event
    try { event = JSON.parse(msg.data) } catch { return }
    const st = useStore.getState()
    if (event.type === 'board_changed' && st.route.page === 'board' && st.route.boardId === event.board_id) {
      st.refreshBoard()
    }
    if (event.type === 'board_changed' || event.type === 'board_deleted') {
      st.refreshBoards()
      if (st.route.page === 'home') st.refreshStats()
      if (st.route.page === 'mywork') st.refreshMyWork()
    }
    if (event.type === 'notification') st.refreshNotifications()
  }
}
export function disconnectEvents() {
  if (es) { es.close(); es = null }
}
