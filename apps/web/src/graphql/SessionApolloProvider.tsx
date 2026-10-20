/**
 * Description: Provides an Apollo Client tied to the current session; a new client (with an empty
 * cache and a fresh WebSocket) is created whenever the user signs in or out.
 * Index:
 *   - SessionApolloProvider: ApolloProvider isolated for each session transition
 */
import { useEffect, useMemo, type ReactNode } from 'react'
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

  useEffect(() => session.dispose, [session])

  return <ApolloProvider client={session.client}>{children}</ApolloProvider>
}
