/**
 * Description: Provides an Apollo Client tied to the current session; a new client (with an empty
 * cache and a fresh WebSocket) is created whenever the user signs in or out.
 * Index:
 *   - SessionApolloProvider: ApolloProvider keyed to the session token
 */
import { useEffect, useMemo, type ReactNode } from 'react'
import { ApolloProvider } from '@apollo/client/react'
import { useAuth } from '@/features/auth/useAuth'
import { createApolloClient } from './createApolloClient'

/** Wraps children in an ApolloProvider whose client authenticates with the session's JWT. */
export function SessionApolloProvider({ children }: { children: ReactNode }) {
  const { token, expireSession } = useAuth()
  const session = useMemo(
    () => createApolloClient({ token, onUnauthorized: expireSession }),
    [token, expireSession],
  )

  useEffect(() => session.dispose, [session])

  return <ApolloProvider client={session.client}>{children}</ApolloProvider>
}
