/**
 * Description: Provides an Apollo Client tied to the current session; a new client (with an empty
 * cache and a fresh WebSocket) is created whenever the user signs in or out. StrictMode setup
 * reuses its socket; only a lasting unmount or session replacement stops reconnection.
 * Index:
 *   - SessionApolloProvider: ApolloProvider isolated for each session transition
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { ApolloProvider } from '@apollo/client/react'
import { useAuth } from '@/features/auth/useAuth'
import { createApolloClient } from './createApolloClient'

/** Replaces caches and closes the old socket when the browser session changes. */
export function SessionApolloProvider({ children }: { children: ReactNode }) {
  const { user, csrfToken, expireSession } = useAuth()
  const session = useMemo(
    () => createApolloClient({ signedIn: user !== null, csrfToken, onUnauthorized: expireSession }),
    [user, csrfToken, expireSession],
  )

  const activeSession = useRef<typeof session | null>(null)
  useEffect(() => {
    activeSession.current = session
    return () => {
      activeSession.current = null
      // StrictMode immediately reuses this session after its cleanup rehearsal.
      // Permanently disconnect only when it stays unmounted or is replaced.
      queueMicrotask(() => {
        if (activeSession.current !== session) session.dispose()
      })
    }
  }, [session])

  return <ApolloProvider client={session.client}>{children}</ApolloProvider>
}
