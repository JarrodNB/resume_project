/**
 * Description: Holds the session JWT (persisted in localStorage) and the sign-in/up/out actions.
 * Index:
 *   - AuthProvider: context provider for useAuth
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { signInRequest, signOutRequest, signUpRequest, type AuthCredentials } from './authApi'
import { AuthContext, type AuthContextValue } from './authContext'
import { clearAuthToken, readAuthToken, saveAuthToken } from './authTokenStorage'

/** Provides the session to the app; starts from any token saved by a previous visit. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(readAuthToken)

  const startSession = useCallback((newToken: string) => {
    saveAuthToken(newToken)
    setToken(newToken)
  }, [])

  const expireSession = useCallback(() => {
    clearAuthToken()
    setToken(null)
  }, [])

  const signIn = useCallback(
    async (credentials: AuthCredentials) => startSession(await signInRequest(credentials)),
    [startSession],
  )

  const signUp = useCallback(
    async (credentials: AuthCredentials) => startSession(await signUpRequest(credentials)),
    [startSession],
  )

  const signOut = useCallback(async () => {
    if (token) await signOutRequest(token).catch(() => undefined)
    expireSession()
  }, [token, expireSession])

  const value = useMemo<AuthContextValue>(
    () => ({ token, signIn, signUp, signOut, expireSession }),
    [token, signIn, signUp, signOut, expireSession],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
