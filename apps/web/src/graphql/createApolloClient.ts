/**
 * Description: Builds the Apollo Client for one session. Queries and mutations (including file
 * uploads, via the GraphQL multipart spec) go over HTTP; subscriptions go over ActionCable.
 * Index:
 *   - ApolloSession: the client plus a dispose function that closes its WebSocket connection
 *   - createApolloClient: builds the client for a JWT
 */
import { ApolloClient, ApolloLink, InMemoryCache } from '@apollo/client'
import { ServerError } from '@apollo/client/errors'
import { ErrorLink } from '@apollo/client/link/error'
import { createConsumer } from '@rails/actioncable'
import UploadHttpLink from 'apollo-upload-client/UploadHttpLink.mjs'
import ActionCableLink from 'graphql-ruby-client/subscriptions/ActionCableLink'
import { OperationTypeNode } from 'graphql'
import { CABLE_URL, GRAPHQL_URL } from '@/lib/apiConfig'

export interface ApolloSession {
  client: ApolloClient
  dispose: () => void
}

interface CreateApolloClientOptions {
  token: string | null
  /** Called when the API rejects the token (HTTP 401), e.g. after it expires. */
  onUnauthorized: () => void
}

/** Creates a client that authenticates every request with `token`. */
export function createApolloClient({ token, onUnauthorized }: CreateApolloClientOptions): ApolloSession {
  const httpLink = new UploadHttpLink({
    uri: GRAPHQL_URL,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  const unauthorizedLink = new ErrorLink(({ error }) => {
    if (ServerError.is(error) && error.statusCode === 401) onUnauthorized()
  })

  // Browsers can't set headers on WebSockets, so the cable authenticates with a query param.
  const cable = token ? createConsumer(`${CABLE_URL}?token=${encodeURIComponent(token)}`) : null
  const transportLink = cable
    ? ApolloLink.split(
        (operation) => operation.operationType === OperationTypeNode.SUBSCRIPTION,
        new ActionCableLink({ cable }),
        httpLink,
      )
    : httpLink

  const client = new ApolloClient({
    link: ApolloLink.from([unauthorizedLink, transportLink]),
    cache: new InMemoryCache(),
  })

  // Disconnecting is safe to undo: ActionCable reconnects when a new subscription is created,
  // which matters because React StrictMode runs effect cleanups twice in development.
  return { client, dispose: () => cable?.disconnect() }
}
