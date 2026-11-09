import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const root = document.getElementById('root')!
const page = (
  <StrictMode>
    <App />
  </StrictMode>
)

// Production builds ship the page already rendered (scripts/prerender.mjs), so hydrate it.
// The dev server serves an empty root, so render from scratch there.
if (root.hasChildNodes()) hydrateRoot(root, page)
else createRoot(root).render(page)
