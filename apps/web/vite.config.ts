/// <reference types="vitest/config" />
/**
 * Description: Vite config for the main web app, set up to run inside Docker. Also configures Vitest.
 * Index:
 *   - default export: Vite config (React + Tailwind plugins, `@` alias to src/, dev server on
 *     0.0.0.0:5173 with polling, Vitest with jsdom)
 */
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    // File change events don't cross the Windows -> Docker bind mount, so poll instead.
    watch: { usePolling: true },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
