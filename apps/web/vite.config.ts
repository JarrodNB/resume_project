/// <reference types="vitest/config" />
/**
 * Description: Vite config for the main web app, set up to run inside Docker. Also configures Vitest.
 * Index:
 *   - productNameHtml: writes the product name into index.html
 *   - default export: Vite config (React + Tailwind plugins, `@` alias to src/, dev server on
 *     0.0.0.0:5173, Vitest with jsdom)
 */
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { PRODUCT_NAME } from './src/lib/productName'

/** Replaces `%PRODUCT_NAME%` in index.html from the product-name module. */
function productNameHtml(): Plugin {
  return {
    name: 'product-name-html',
    transformIndexHtml(html) {
      return html.replaceAll('%PRODUCT_NAME%', PRODUCT_NAME)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), productNameHtml()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
