/// <reference types="vitest/config" />
/**
 * Description: Vite config for the main web app, set up to run inside Docker. Also configures Vitest.
 * Index:
 *   - productNameHtml: writes the product name into index.html
 *   - requireRealLegalContact: stops production builds while the policy contact is a placeholder
 *   - default export: Vite config (React + Tailwind plugins, `@` alias to src/, dev server on
 *     0.0.0.0:5173, Vitest with jsdom)
 */
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { PRIVACY_CONTACT_EMAIL } from './src/features/legal/legalDetails.js'
import { PRODUCT_NAME } from './src/lib/productName.js'

/** Replaces `%PRODUCT_NAME%` in index.html from the product-name module. */
function productNameHtml(): Plugin {
  return {
    name: 'product-name-html',
    transformIndexHtml(html) {
      return html.replaceAll('%PRODUCT_NAME%', PRODUCT_NAME)
    },
  }
}

/** Stops production builds until the policies list an inbox that can really receive mail. */
function requireRealLegalContact(): Plugin {
  return {
    name: 'require-real-legal-contact',
    apply: 'build',
    buildStart() {
      if (PRIVACY_CONTACT_EMAIL.endsWith('.example')) {
        this.error('Set PRIVACY_CONTACT_EMAIL in src/features/legal/legalDetails.ts before building for production.')
      }
    },
  }
}

/** Serves one allowlisted example resume for exercising the real import flow locally. */
function devSampleResume(): Plugin {
  return {
    name: 'dev-sample-resume',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev-sample-resume', async (request, response, next) => {
        if (request.method !== 'GET') {
          response.statusCode = 405
          response.end()
          return
        }
        try {
          const file = await readFile('/example_resumes/uci_business.pdf')
          response.setHeader('Content-Type', 'application/pdf')
          response.setHeader('Content-Length', file.byteLength)
          response.end(file)
        } catch (error) {
          next(error)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), productNameHtml(), requireRealLegalContact(), devSampleResume()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/ai/executions/stream': {
        target: process.env.AI_HTTP_TARGET ?? 'http://ai-http:8000',
        ws: true,
      },
      '/interview-transcription/stream': {
        target: process.env.INTERVIEW_TRANSCRIPTION_TARGET ?? 'http://ai-http:8000',
        ws: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Slow UI tests take 1-3s alone but pass 5s when many jsdom workers run at once.
    testTimeout: 15_000,
  },
})
