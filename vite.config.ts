import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), cloudflare()],
  server: {
    // Spotify refuse « localhost » comme redirect URI : on sert sur 127.0.0.1.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
})
