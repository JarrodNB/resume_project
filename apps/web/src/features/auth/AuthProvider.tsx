/** Loads the browser session before rendering routes and isolates session transitions.
 * Cookies remain private to the browser. Failed bootstrap requests offer an explicit retry. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { sessionRequest, signInRequest, signOutRequest, signUpRequest, type AuthCredentials, type BrowserSession } from './authApi'
import { AuthContext, type AuthContextValue } from './authContext'
import { productStorageKey } from '@/lib/productName'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<BrowserSession | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const generation = useRef(0)
  const broadcasts = useRef<BroadcastChannel | null>(null)

  const expireSession = useCallback(() => {
    generation.current++
    setSession(null)
    setError(false)
    setAttempt((value) => value + 1)
  }, [])

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel('careergrind-session')
    broadcasts.current = channel
    channel.onmessage = expireSession
    return () => { channel.close(); broadcasts.current = null }
  }, [expireSession])

  useEffect(() => {
    localStorage.removeItem(productStorageKey('authToken'))
    const controller = new AbortController()
    const current = ++generation.current
    sessionRequest(controller.signal).then((value) => {
      if (current === generation.current) { setSession(value); setError(false) }
    }).catch(() => { if (!controller.signal.aborted && current === generation.current) setError(true) })
    return () => controller.abort()
  }, [attempt])

  const startSession = useCallback(async (request: () => Promise<BrowserSession>) => {
    const current = ++generation.current
    const value = await request()
    if (current === generation.current) {
      setSession(value)
      broadcasts.current?.postMessage('changed')
    }
  }, [])
  const signIn = useCallback(async (credentials: AuthCredentials) => {
    if (session) await startSession(() => signInRequest(credentials, session.csrfToken))
  }, [session, startSession])
  const signUp = useCallback(async (credentials: AuthCredentials) => {
    if (session) await startSession(() => signUpRequest(credentials, session.csrfToken))
  }, [session, startSession])
  const signOut = useCallback(async () => {
    if (!session) return
    // Keep the session visible if the server could not confirm revocation.
    await signOutRequest(session.csrfToken)
    broadcasts.current?.postMessage('changed')
    expireSession()
  }, [session, expireSession])
  if (error) return <div role="alert">Could not check your session. <button onClick={() => { setError(false); setAttempt((value) => value + 1) }}>Try again</button></div>
  if (!session) return <p role="status">Checking your session…</p>
  const value: AuthContextValue = { ...session, signIn, signUp, signOut, expireSession }
  return <AuthContext value={value}>{children}</AuthContext>
}
