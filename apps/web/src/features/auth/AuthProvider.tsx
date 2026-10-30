/** Loads the browser session before rendering routes and isolates session transitions.
 * Cookies remain private to the browser. Failed bootstrap requests show an app availability
 * message and offer a retry without changing the requested route or clearing credentials. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { onInvalidCsrf, sessionRequest, signInRequest, signOutRequest, signUpRequest, type AuthCredentials, type BrowserSession } from './authApi'
import { AuthContext, type AuthContextValue } from './authContext'
import { PRODUCT_NAME, productStorageKey } from '@/lib/productName'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<BrowserSession | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const generation = useRef(0)
  const broadcasts = useRef<BroadcastChannel | null>(null)

  const expireSession = useCallback((broadcast = false) => {
    if (broadcast) broadcasts.current?.postMessage('changed')
    generation.current++
    setSession(null)
    setError(false)
    setAttempt((value) => value + 1)
  }, [])

  useEffect(() => onInvalidCsrf(expireSession), [expireSession])

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel('careergrind-session')
    broadcasts.current = channel
    channel.onmessage = () => expireSession()
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
    if (session) await signUpRequest(credentials, session.csrfToken)
  }, [session])
  const signOut = useCallback(async () => {
    if (!session) return
    // Keep the session visible if the server could not confirm revocation.
    await signOutRequest(session.csrfToken)
    broadcasts.current?.postMessage('changed')
    expireSession()
  }, [session, expireSession])
  if (error) return <main className="flex min-h-svh items-center justify-center px-6 py-12">
    <div className="grid w-full max-w-md justify-items-start gap-6">
      <div role="alert" className="grid gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">We couldn’t load {PRODUCT_NAME}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">Something went wrong on our side. Please try again in a moment.</p>
      </div>
      <Button type="button" className="min-h-11" onClick={() => { setError(false); setAttempt((value) => value + 1) }}>Try again</Button>
    </div>
  </main>
  if (!session) return <main className="flex min-h-svh items-center justify-center px-6 py-12">
    <p role="status" className="session-check flex items-center gap-3 text-sm text-muted-foreground">
      <LoaderCircle aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" />
      Checking your session…
    </p>
  </main>
  const value: AuthContextValue = { ...session, signIn, signUp, signOut, expireSession }
  return <AuthContext value={value}>{children}</AuthContext>
}
