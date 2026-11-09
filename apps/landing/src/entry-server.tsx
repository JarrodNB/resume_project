/** Turns the landing page into plain HTML text at build time.
 * Used only by scripts/prerender.mjs, so crawlers that skip JavaScript still see the page.
 */
import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import App from './App.tsx'

export function renderLandingPageHtml(): string {
  return renderToString(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
