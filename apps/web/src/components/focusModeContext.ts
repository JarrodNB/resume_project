/** Lets a page ask the workspace to hide its navigation while the user is in focused work
 * (a live spoken interview). The workspace layout owns the flag; pages turn it on with `useFocusMode`. */
import { createContext } from 'react'

export const FocusModeContext = createContext<(focused: boolean) => void>(() => {})
