/**
 * Description: Vite config for the main web app, set up to run inside Docker.
 * Index:
 *   - default export: Vite config (React plugin, dev server on 0.0.0.0:5173 with polling)
 */
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    // File change events don't cross the Windows -> Docker bind mount, so poll instead.
    watch: { usePolling: true },
  },
})
