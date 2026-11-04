/**
 * Vite config for the landing page, set up to run inside Docker on 0.0.0.0:5174.
 * Production builds stop if VITE_APP_URL is missing, so sign-up links can never ship pointing
 * at localhost.
 */
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ command, mode }) => {
  if (command === 'build' && !loadEnv(mode, process.cwd(), 'VITE_').VITE_APP_URL) {
    throw new Error('Set VITE_APP_URL to the web app address before building the landing page.')
  }
  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5174,
      strictPort: true,
    },
  }
})
