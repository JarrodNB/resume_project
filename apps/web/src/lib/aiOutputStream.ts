/** Observe one owned chat attempt without starting or retrying model execution.
 * Capabilities travel in the first frame, never a URL. Lost buffers restore saved state;
 * reconnect only reattaches an observer with its cursor and a fresh capability.
 */
export interface ChatStreamOperation { id: string; attemptId: string | null; claimGeneration: number }
interface Options {
  operation: ChatStreamOperation
  authorize: () => Promise<string | null>
  onText: (text: string) => void
  onReconcile: () => void
  createSocket?: (url: string) => WebSocket
}
const cursorPattern = /^(0|[1-9][0-9]{0,19})-(0|[1-9][0-9]{0,19})$/

export function observeChatOutput({ operation, authorize, onText, onReconcile, createSocket = (url) => new WebSocket(url) }: Options): () => void {
  let stopped = false
  let socket: WebSocket | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let retries = 0
  let cursor = '0-0'
  let text = ''

  function detach() {
    if (!socket) return
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
    socket.close()
    socket = undefined
  }
  function finish(clear = false) {
    if (stopped) return
    stopped = true
    if (timer) clearTimeout(timer)
    detach()
    if (clear) onText('')
    onReconcile()
  }
  function reconnect() {
    if (stopped) return
    detach()
    if (retries >= 3) { finish(true); return }
    timer = setTimeout(() => { void connect() }, [500, 1000, 2000][retries++])
  }
  async function connect() {
    try {
      const token = await authorize()
      if (stopped) return
      if (!token) { finish(true); return }
      const url = new URL('/ai/executions/stream', window.location.href)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = createSocket(url.toString())
      socket.onopen = () => socket?.send(JSON.stringify({ type: 'authorize', token, cursor }))
      socket.onerror = () => reconnect()
      socket.onclose = () => reconnect()
      socket.onmessage = ({ data }) => {
        try {
          if (typeof data !== 'string' || data.length > 32_768) { finish(true); return }
          const event: unknown = JSON.parse(data)
          if (!event || typeof event !== 'object' || Array.isArray(event)) { finish(true); return }
          const value = event as Record<string, unknown>
          if (value.type === 'reset' || value.type === 'error') { finish(true); return }
          if (value.feature !== 'chat' || value.operation_id !== operation.id || value.attempt_id !== operation.attemptId || value.claim_generation !== operation.claimGeneration) { finish(true); return }
          if (value.type === 'attached') return
          if (typeof value.cursor !== 'string' || !cursorPattern.test(value.cursor)) { finish(true); return }
          const nextCursor = value.cursor.split('-').map(BigInt)
          const previousCursor = cursor.split('-').map(BigInt)
          if (nextCursor[0] < previousCursor[0] || (nextCursor[0] === previousCursor[0] && nextCursor[1] <= previousCursor[1])) return
          cursor = value.cursor
          if (value.type === 'delta') {
            if (typeof value.text !== 'string' || !value.text || Array.from(value.text).length > 4096 || Array.from(text + value.text).length > 8000) { finish(true); return }
            text += value.text
            onText(text)
          } else if (value.type === 'completed') finish()
          else if (['failed', 'cancelled', 'superseded'].includes(String(value.type))) finish(true)
          else if (value.type !== 'started') finish(true)
        } catch { finish(true) }
      }
    } catch { finish(true) }
  }
  void connect()
  return () => { stopped = true; if (timer) clearTimeout(timer); detach() }
}
