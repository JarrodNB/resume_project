/**
 * Description: Hook for reading the session and auth actions.
 * Index:
 *   - useAuth: returns the AuthContext value (must be inside AuthProvider)
 */
import { use } from 'react'
import { AuthContext, type AuthContextValue } from './authContext'

/** Returns the current session and the sign-in/up/out actions. */
export function useAuth(): AuthContextValue {
  const value = use(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
