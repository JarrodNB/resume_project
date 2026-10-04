/**
 * Description: Browser entry point: loads global styles, applies the color theme, and mounts App
 * into #root.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyColorTheme, preferredColorTheme } from './lib/colorTheme'

applyColorTheme(preferredColorTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
