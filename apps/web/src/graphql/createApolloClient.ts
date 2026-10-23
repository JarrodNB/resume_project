/**
 * Description: Builds the Apollo Client for one session. Queries and mutations (including file
 * uploads, via the GraphQL multipart spec) go over HTTP; subscriptions go over ActionCable.
 * Index:
 *   - ApolloSession: the client plus a dispose function that closes its WebSocket connection
 *   - createApolloClient: builds cookie/CSRF HTTP and cookie-authenticated Cable transports
 */
import { ApolloClient, ApolloLink, InMemoryCache } from '@apollo/client'
import { ServerError } from '@apollo/client/errors'
import { ErrorLink } from '@apollo/client/link/error'
import { createConsumer } from '@rails/actioncable'
import UploadHttpLink from 'apollo-upload-client/UploadHttpLink.mjs'
import ActionCableLink from 'graphql-ruby-client/subscriptions/ActionCableLink'
import { orderedInterviewSnapshots } from '@/features/interviews/orderedInterviewSnapshots'
import { OperationTypeNode } from 'graphql'
import { CABLE_URL, GRAPHQL_URL } from '@/lib/apiConfig'

export interface ApolloSession {
  client: ApolloClient
  dispose: () => void
}

interface CreateApolloClientOptions {
  signedIn: boolean
  csrfToken: string
  /** Called when the API rejects the session or its CSRF state. */
  onUnauthorized: () => void
}

/** Creates an isolated cache and authenticated transports for one browser session. */
export function createApolloClient({ signedIn, csrfToken, onUnauthorized }: CreateApolloClientOptions): ApolloSession {
  const httpLink = new UploadHttpLink({
    uri: GRAPHQL_URL,
    credentials: 'include',
    headers: { 'X-CSRF-Token': csrfToken },
  })
  const unauthorizedLink = new ErrorLink(({ error }) => {
    if (!ServerError.is(error)) return
    if (error.statusCode === 401) onUnauthorized()
    else if (error.statusCode === 422) {
      try {
        if (JSON.parse(error.bodyText).code === 'invalid_csrf') onUnauthorized()
      } catch { /* Other non-JSON errors keep their normal error handling. */ }
    }
  })

  // The browser supplies the HttpOnly session cookie on the WebSocket handshake.
  const cable = signedIn ? createConsumer(CABLE_URL) : null
  const transportLink = cable
    ? ApolloLink.split(
        (operation) => operation.operationType === OperationTypeNode.SUBSCRIPTION,
        new ActionCableLink({ cable }),
        httpLink,
      )
    : httpLink

  const cache = new InMemoryCache()
  const client = new ApolloClient({
    link: ApolloLink.from([unauthorizedLink, orderedInterviewSnapshots(cache), transportLink]),
    cache,
  })

  // Disposal permanently stops this session's reconnect monitor. The provider
  // keeps it alive through StrictMode's immediate cleanup/setup rehearsal.
  return { client, dispose: () => cable?.disconnect() }
}
