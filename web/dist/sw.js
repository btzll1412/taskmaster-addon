/* TaskMaster service worker: instant loads for the app shell, network for data. */
const CACHE = 'tm-v1'

self.addEventListener('install', (e) => self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api')) return
  // hashed assets: cache-first (immutable); pages: network-first with cache fallback
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(e.request)
      if (hit) return hit
      const res = await fetch(e.request)
      if (res.ok) c.put(e.request, res.clone())
      return res
    }))
  } else {
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone())).catch(() => {})
      return res.clone()
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match('/'))))
  }
})
