/**
 * Description: Header button that switches between the light and dark color themes.
 * Index:
 *   - ThemeToggle: sun/moon icon button
 */
import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { applyColorTheme, preferredColorTheme, type ColorTheme } from '@/lib/colorTheme'

/** Toggles the color theme and remembers the choice. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<ColorTheme>(preferredColorTheme)
  const nextTheme: ColorTheme = theme === 'dark' ? 'light' : 'dark'

  function toggle() {
    applyColorTheme(nextTheme, { remember: true })
    setTheme(nextTheme)
  }

  return (
    <Button variant="ghost" size="icon" aria-label={`Switch to ${nextTheme} theme`} onClick={toggle}>
      {theme === 'dark' ? <Sun /> : <Moon />}
    </Button>
  )
}
