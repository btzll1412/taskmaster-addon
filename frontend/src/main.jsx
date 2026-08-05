import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '@fontsource/figtree/400.css'
import '@fontsource/figtree/500.css'
import '@fontsource/figtree/600.css'
import '@fontsource/figtree/700.css'
import './styles/base.css'
import './styles/components.css'
import './styles/board.css'

createRoot(document.getElementById('root')).render(<App />)

// PWA: offline shell + install-to-home-screen
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
