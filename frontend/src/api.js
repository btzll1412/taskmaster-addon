// Called when the server says the session is gone (expired or logged out
// elsewhere) — the store registers a handler that returns to the login screen.
let onSessionExpired = null
export function setSessionExpiredHandler(fn) { onSessionExpired = fn }

async function request(method, url, body) {
  const opts = { method, credentials: 'same-origin', headers: {} }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const res = await fetch(url, opts)
  let data = null
  try { data = await res.json() } catch { /* empty body */ }
  if (!res.ok) {
    // auth endpoints handle their own 401s (e.g. a wrong password on login)
    if (res.status === 401 && !url.startsWith('/api/auth/') && onSessionExpired) {
      onSessionExpired()
    }
    const err = new Error((data && data.error) || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
  upload: async (url, file) => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(url, { method: 'POST', body: fd, credentials: 'same-origin' })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error((data && data.error) || 'Upload failed')
    return data
  },
}
