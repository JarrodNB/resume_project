/**
 * Description: React context for the signed-in session (provided by AuthProvider, read with useAuth).
 * Index:
 *   - AuthContextValue: token plus sign-in/up/out actions
 *   - AuthContext: the context object
 */
import { createContext } from 'react'
import type { AuthCredentials } from './authApi'

export interface AuthContextValue {
  /** The JWT, or null when signed out. */
  token: string | null
  signIn: (credentials: AuthCredentials) => Promise<void>
  signUp: (credentials: AuthCredentials) => Promise<void>
  signOut: () => Promise<void>
  /** Drops a token the server rejected (expired or revoked) without calling the API. */
  expireSession: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
