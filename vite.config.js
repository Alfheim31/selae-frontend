import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { selaeApi } from './server/plugin.js'

export default defineConfig({
  plugins: [react(), tailwindcss(), selaeApi()],
  // Listen on the local network too, so phones on the same Wi-Fi can open event pages and register
  server: { host: true },
  preview: { host: true },
})
