import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Assets are served by Flask from any path (including behind reverse proxies),
  // so keep asset URLs relative.
  base: './',
  build: {
    outDir: '../web/dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8123',
    },
  },
})
