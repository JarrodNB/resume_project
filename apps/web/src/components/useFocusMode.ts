/** Hides the workspace navigation while `active` is true, and restores it when the page leaves. */
import { use, useEffect } from 'react'
import { FocusModeContext } from './focusModeContext'

export function useFocusMode(active: boolean) {
  const setFocused = use(FocusModeContext)
  useEffect(() => {
    setFocused(active)
    return () => setFocused(false)
  }, [active, setFocused])
}
