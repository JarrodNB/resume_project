/** Safe session state shared by route guards and the per-session Apollo client. */
import { createContext } from 'react'
import type { AuthCredentials, BrowserSession } from './authApi'
export interface AuthContextValue extends BrowserSession {
  signIn: (credentials: AuthCredentials) => Promise<void>
  signUp: (credentials: AuthCredentials, turnstileToken: string) => Promise<void>
  signOut: () => Promise<void>
  expireSession: (broadcast?: boolean) => void
  /** True after someone signed out on purpose (here or in another tab), so the next sign-in starts at home. */
  signedOut: boolean
}
export const AuthContext = createContext<AuthContextValue | null>(null)
