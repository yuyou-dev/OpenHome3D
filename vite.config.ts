import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { pickPort } from './scripts/pick-port.mjs'
import { aiApi } from './scripts/ai-api.mjs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), aiApi()],
  server: {
    host: '127.0.0.1',
    port: pickPort(),
    strictPort: false,
  },
})
