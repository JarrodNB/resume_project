/** HTTP auth uses cookies and CSRF; each Apollo session owns a disposable socket/cache. */
import { gql } from '@apollo/client'
import { afterEach, expect, it, vi } from 'vitest'
import { createApolloClient } from './createApolloClient'
const { disconnect, createConsumer } = vi.hoisted(() => ({ disconnect: vi.fn(), createConsumer: vi.fn() }))
vi.mock('@rails/actioncable', () => ({ createConsumer: createConsumer.mockImplementation(() => ({ disconnect })) }))
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
const query = gql`query { me { email } }`
it('sends credentials and CSRF without exposing a session credential in the socket URL', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { me: { email: 'ada@example.com' } } }), { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetch)
  const session = createApolloClient({ signedIn: true, csrfToken: 'csrf', onUnauthorized: vi.fn() })
  await session.client.query({ query })
  const options = fetch.mock.calls[0][1]
  expect(options.credentials).toBe('include')
  expect(new Headers(options.headers).get('X-CSRF-Token')).toBe('csrf')
  expect(new Headers(options.headers).get('Authorization')).toBeNull()
  expect(createConsumer).toHaveBeenCalledWith('ws://localhost:3000/cable')
  session.dispose()
  expect(disconnect).toHaveBeenCalledOnce()
  const next = createApolloClient({ signedIn: true, csrfToken: 'new-csrf', onUnauthorized: vi.fn() })
  expect(next.client.readQuery({ query })).toBeNull()
  next.dispose()
})
it('expires auth on an HTTP 401', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })))
  const onUnauthorized = vi.fn()
  const session = createApolloClient({ signedIn: true, csrfToken: 'csrf', onUnauthorized })
  await expect(session.client.query({ query })).rejects.toThrow()
  expect(onUnauthorized).toHaveBeenCalledOnce()
  session.dispose()
})
