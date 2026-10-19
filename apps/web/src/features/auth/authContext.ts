/** Safe session state shared by route guards and the per-session Apollo client. */
import { createContext } from 'react'
import type { AuthCredentials, BrowserSession } from './authApi'
export interface AuthContextValue extends BrowserSession {
  signIn: (credentials: AuthCredentials) => Promise<void>
  signUp: (credentials: AuthCredentials) => Promise<void>
  signOut: () => Promise<void>
  expireSession: (broadcast?: boolean) => void
}
export const AuthContext = createContext<AuthContextValue | null>(null)
