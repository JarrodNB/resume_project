/** Exercises the public output observer with a controlled socket and canonical identity. */
import { expect, it, vi } from 'vitest'
import { observeChatOutput } from './chatOutputStream'

class Socket {
  static instances: Socket[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  closed = false
  url: string
  constructor(url: string) { this.url = url; Socket.instances.push(this) }
  send(value: string) { this.sent.push(value) }
  close() { this.closed = true }
  receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }) }
}
const identity = { id: 'operation', attemptId: 'attempt', claimGeneration: 2 }
const event = (type: string, extra = {}) => ({ type, version: 1, feature: 'chat', operation_id: 'operation', attempt_id: 'attempt', claim_generation: 2, ...extra })

it('sends a capability only in the first frame and reconciles completion', async () => {
  const text = vi.fn(), reconcile = vi.fn()
  const dispose = observeChatOutput({ operation: identity, authorize: async () => 'secret-token', onText: text, onReconcile: reconcile,
    createSocket: (url) => new Socket(url) as unknown as WebSocket })
  await vi.waitFor(() => expect(Socket.instances.length).toBeGreaterThan(0))
  const socket = Socket.instances.at(-1)!
  expect(socket.url).not.toContain('secret-token')
  socket.onopen?.()
  expect(JSON.parse(socket.sent[0])).toEqual({ type: 'authorize', token: 'secret-token', cursor: '0-0' })
  socket.receive(event('attached'))
  socket.receive(event('delta', { text: 'A career ', cursor: '1-0' }))
  socket.receive(event('delta', { text: 'step.', cursor: '2-0' }))
  expect(text).toHaveBeenLastCalledWith('A career step.')
  socket.receive(event('completed', { cursor: '3-0' }))
  expect(reconcile).toHaveBeenCalledTimes(1)
  expect(socket.closed).toBe(true)
  dispose()
})

it('clears provisional output when reset or a foreign attempt arrives', async () => {
  for (const reset of [{ type: 'reset', code: 'saved_state_required' }, event('delta', { attempt_id: 'foreign', text: 'private', cursor: '2-0' })]) {
    const text = vi.fn(), reconcile = vi.fn(), before = Socket.instances.length
    observeChatOutput({ operation: identity, authorize: async () => 'secret', onText: text, onReconcile: reconcile,
      createSocket: (url) => new Socket(url) as unknown as WebSocket })
    await vi.waitFor(() => expect(Socket.instances.length).toBe(before + 1))
    const socket = Socket.instances.at(-1)!
    socket.receive(event('delta', { text: 'Draft', cursor: '1-0' }))
    socket.receive(reset)
    expect(text).toHaveBeenLastCalledWith('')
    expect(reconcile).toHaveBeenCalledTimes(1)
    expect(socket.closed).toBe(true)
  }
})

it('reattaches with a fresh capability and cursor without replaying execution', async () => {
  vi.useFakeTimers()
  try {
    const text = vi.fn(), reconcile = vi.fn(), authorize = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second')
    const dispose = observeChatOutput({ operation: identity, authorize, onText: text, onReconcile: reconcile,
      createSocket: (url) => new Socket(url) as unknown as WebSocket })
    await Promise.resolve()
    const first = Socket.instances.at(-1)!
    first.receive(event('delta', { text: 'One', cursor: '4-0' }))
    first.onclose?.()
    await vi.advanceTimersByTimeAsync(500)
    const second = Socket.instances.at(-1)!
    second.onopen?.()
    expect(JSON.parse(second.sent[0])).toEqual({ type: 'authorize', token: 'second', cursor: '4-0' })
    second.receive(event('delta', { text: ' more', cursor: '5-0' }))
    expect(text).toHaveBeenLastCalledWith('One more')
    dispose()
    expect(second.closed).toBe(true)
    expect(reconcile).not.toHaveBeenCalled()
  } finally { vi.useRealTimers() }
})

it('does not attach after unmount while capability authorization is pending', async () => {
  let resolve!: (value: string) => void
  const before = Socket.instances.length
  const dispose = observeChatOutput({ operation: identity, authorize: () => new Promise((done) => { resolve = done }),
    onText: vi.fn(), onReconcile: vi.fn(), createSocket: (url) => new Socket(url) as unknown as WebSocket })
  dispose()
  resolve('token')
  await Promise.resolve()
  expect(Socket.instances.length).toBe(before)
})

it('ignores a duplicate replay cursor and rejects oversized provisional text', async () => {
  const text = vi.fn(), reconcile = vi.fn(), before = Socket.instances.length
  observeChatOutput({ operation: identity, authorize: async () => 'secret', onText: text, onReconcile: reconcile,
    createSocket: (url) => new Socket(url) as unknown as WebSocket })
  await vi.waitFor(() => expect(Socket.instances.length).toBe(before + 1))
  const socket = Socket.instances.at(-1)!
  socket.receive(event('delta', { text: 'First', cursor: '1-0' }))
  socket.receive(event('delta', { text: 'First', cursor: '1-0' }))
  expect(text).toHaveBeenCalledTimes(1)
  socket.receive(event('delta', { text: 'a'.repeat(4097), cursor: '2-0' }))
  expect(text).toHaveBeenLastCalledWith('')
  expect(reconcile).toHaveBeenCalledTimes(1)
})
