/** Exercises session socket ownership with the real ActionCable reconnect monitor.
 * Only the WebSocket boundary is simulated; React StrictMode and Apollo subscriptions run normally.
 */
import { StrictMode } from 'react'
import { gql } from '@apollo/client'
import { useSubscription } from '@apollo/client/react'
import { adapters } from '@rails/actioncable'
import { act, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '@/features/auth/authContext'
import { SessionApolloProvider } from './SessionApolloProvider'

class TestSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: TestSocket[] = []
  readyState = TestSocket.CONNECTING
  protocol = 'actioncable-v1-json'
  sent: Array<{ command: string; identifier: string; data?: string }> = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  close = vi.fn(() => { this.readyState = TestSocket.CLOSED; this.onclose?.() })
  constructor() { TestSocket.instances.push(this) }
  send(data: string) { this.sent.push(JSON.parse(data)) }
  receive(frame: unknown) { this.onmessage?.({ data: JSON.stringify(frame) }) }
  open() { this.readyState = TestSocket.OPEN; this.onopen?.(); this.receive({ type: 'welcome' }) }
  confirm() {
    const identifier = this.sent.findLast((frame) => frame.command === 'subscribe')!.identifier
    this.receive({ type: 'confirm_subscription', identifier })
    return identifier
  }
}

const query = gql`subscription($id: ID!) { interviewSessionUpdated(id: $id) { id revision } }`
function SavedRevision() {
  const { data } = useSubscription<{ interviewSessionUpdated: { id: string; revision: number } }>(query, { variables: { id: 'interview' } })
  return <output>{data?.interviewSessionUpdated.revision ?? 'waiting'}</output>
}
const originalSocket = adapters.WebSocket
const auth: AuthContextValue = {
  user: { id: 'owner', email: 'owner@example.test', name: 'Owner' }, csrfToken: 'csrf',
  signIn: vi.fn(), signUp: vi.fn(), signOut: vi.fn(), expireSession: vi.fn(),
}
afterEach(() => { adapters.WebSocket = originalSocket; vi.useRealTimers(); vi.restoreAllMocks() })

it('reconnects and receives a fresh snapshot after a server restart following StrictMode setup', async () => {
  vi.useFakeTimers()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  TestSocket.instances = []
  adapters.WebSocket = TestSocket as unknown as typeof WebSocket
  const view = render(<StrictMode><AuthContext value={auth}><SessionApolloProvider><SavedRevision /></SessionApolloProvider></AuthContext></StrictMode>)
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  const first = TestSocket.instances.at(-1)!
  await act(async () => { first.open(); first.confirm() })
  expect(first.sent.some((frame) => frame.command === 'message' && JSON.parse(frame.data!).action === 'execute')).toBe(true)

  await act(async () => {
    first.receive({ type: 'disconnect', reason: 'server_restart', reconnect: true })
    await vi.advanceTimersByTimeAsync(30_000)
  })
  const reconnected = TestSocket.instances.at(-1)!
  expect(reconnected).not.toBe(first)
  await act(async () => {
    reconnected.open()
    const identifier = reconnected.confirm()
    reconnected.receive({ identifier, message: { result: { data: { interviewSessionUpdated: { id: 'interview', revision: 7 } } }, more: true } })
  })
  expect(screen.getByRole('status')).toHaveTextContent('7')
  view.unmount()
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  expect(reconnected.close).toHaveBeenCalledOnce()
})


it('replaces the socket and cache when the authenticated owner changes', async () => {
  vi.useFakeTimers()
  TestSocket.instances = []
  adapters.WebSocket = TestSocket as unknown as typeof WebSocket
  function App({ value }: { value: AuthContextValue }) {
    return <StrictMode><AuthContext value={value}><SessionApolloProvider><SavedRevision /></SessionApolloProvider></AuthContext></StrictMode>
  }
  const view = render(<App value={auth} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  const previous = TestSocket.instances.at(-1)!
  await act(async () => {
    previous.open()
    const identifier = previous.confirm()
    previous.receive({ identifier, message: { result: { data: { interviewSessionUpdated: { id: 'interview', revision: 7 } } }, more: true } })
  })
  expect(screen.getByRole('status')).toHaveTextContent('7')
  view.rerender(<App value={{ ...auth, user: { ...auth.user!, id: 'another-owner' }, csrfToken: 'another-csrf' }} />)
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  expect(previous.close).toHaveBeenCalledOnce()
  expect(TestSocket.instances.at(-1)).not.toBe(previous)
  expect(screen.getByRole('status')).toHaveTextContent('waiting')
  view.unmount()
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
})
