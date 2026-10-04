/**
 * Description: Light/dark color theme preference. The user's choice is kept in localStorage;
 * without one, the system preference is used.
 * Index:
 *   - ColorTheme: 'light' | 'dark'
 *   - preferredColorTheme: stored choice, else the system preference
 *   - applyColorTheme: toggles the `.dark` class on <html> and stores the choice
 */

export type ColorTheme = 'light' | 'dark'

const STORAGE_KEY = 'throughline.colorTheme'

/** Returns the stored theme, falling back to the system's `prefers-color-scheme`. */
export function preferredColorTheme(): ColorTheme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Applies a theme to the document; pass `remember` to store it as the user's choice. */
export function applyColorTheme(theme: ColorTheme, { remember = false } = {}) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  if (remember) localStorage.setItem(STORAGE_KEY, theme)
}
