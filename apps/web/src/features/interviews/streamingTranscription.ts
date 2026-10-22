/** Stream one answer through the AI runtime while a separate recorder preserves fallback audio.
 * The caller authorizes through the signed-in GraphQL client; provider credentials stay server-side.
 */
type Callbacks = { text(text: string): void; fallback(reason: string): void }
type Authorization = () => Promise<{ captureId: string; token: string }>
type Dependencies = { audio(): AudioContext; socket(): WebSocket }

export class Pcm24Encoder {
  private offset = 0
  private tail = new Float32Array(0)
  private readonly step: number
  constructor(sampleRate: number) {
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('Unsupported microphone sample rate')
    this.step = sampleRate / 24000
  }
  encode(samples: Float32Array): ArrayBuffer {
    const input = new Float32Array(this.tail.length + samples.length)
    input.set(this.tail); input.set(samples, this.tail.length)
    const output: number[] = []
    while (this.offset + 1 < input.length) {
      const index = Math.floor(this.offset)
      const fraction = this.offset - index
      const value = Math.max(-1, Math.min(1, input[index] * (1 - fraction) + input[index + 1] * fraction))
      output.push(Math.trunc(value * (value < 0 ? 32768 : 32767)))
      this.offset += this.step
    }
    const consumed = Math.min(Math.floor(this.offset), input.length)
    this.tail = input.slice(consumed)
    this.offset -= consumed
    const bytes = new ArrayBuffer(output.length * 2)
    const view = new DataView(bytes)
    output.forEach((value, index) => view.setInt16(index * 2, value, true))
    return bytes
  }
}

export function startStreamingTranscription(stream: MediaStream, callbacks: Callbacks, authorize: Authorization, dependencies: Dependencies = {
  audio: () => new AudioContext(),
  socket: () => new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/interview-transcription/stream`),
}) {
  let audio: AudioContext | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let processor: ScriptProcessorNode | undefined
  let socket: WebSocket | undefined
  let ended = false
  let stopping = false
  let ready = false
  let committed = false
  let captureId = ''
  let queued: ArrayBuffer[] = []
  let queuedBytes = 0
  let sentBytes = 0
  let settle!: (text: string | null) => void
  const result = new Promise<string | null>(resolve => { settle = resolve })
  let deadline = setTimeout(() => fail('Streaming could not connect. Your recording will be transcribed after submission.'), 10_000)

  function disconnectAudio() {
    if (processor) { processor.onaudioprocess = null; processor.disconnect(); processor = undefined }
    source?.disconnect(); source = undefined
    if (audio) { void audio.close().catch(() => {}); audio = undefined }
  }
  function complete(text: string | null) {
    if (ended) return
    ended = true
    clearTimeout(deadline)
    disconnectAudio()
    queued = []; queuedBytes = 0
    if (socket) {
      socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.onclose = null
      socket.close()
    }
    settle(text)
  }
  function fail(message: string) {
    if (ended) return
    callbacks.fallback(message)
    complete(null)
  }
  function send(value: ArrayBuffer | string) {
    if (!socket || socket.readyState !== 1 || socket.bufferedAmount > 256_000) throw new Error('Streaming disconnected')
    socket.send(value)
  }
  function commit() {
    if (!ready || committed || ended) return
    committed = true
    clearTimeout(deadline)
    deadline = setTimeout(() => fail('Streaming did not finalize. Your recording will be transcribed after submission.'), 10_000)
    send(JSON.stringify({ type: 'commit' }))
  }
  try {
    audio = dependencies.audio()
    const encoder = new Pcm24Encoder(audio.sampleRate)
    source = audio.createMediaStreamSource(stream)
    // The processor output remains silent. The separate MediaRecorder owns the source tracks.
    processor = audio.createScriptProcessor(4096, 1, 1)
    processor.onaudioprocess = event => {
      if (ended || stopping) return
      try {
        const bytes = encoder.encode(event.inputBuffer.getChannelData(0))
        sentBytes += bytes.byteLength
        if (sentBytes > 120 * 24_000 * 2) throw new Error('Streaming capture limit reached')
        for (let offset = 0; offset < bytes.byteLength; offset += 32_768) {
          const frame = bytes.slice(offset, offset + 32_768)
          if (ready) send(frame)
          else {
            queued.push(frame); queuedBytes += frame.byteLength
            if (queuedBytes > 480_000) throw new Error('Streaming connection is too slow')
          }
        }
      } catch { fail('Streaming was interrupted. Your recording will be transcribed after submission.') }
    }
    source.connect(processor); processor.connect(audio.destination)
    void audio.resume().catch(() => fail('Streaming audio could not start. Your recording will be transcribed after submission.'))
    void authorize().then(grant => {
      if (ended) return
      captureId = grant.captureId
      socket = dependencies.socket()
      socket.onopen = () => {
        try { send(JSON.stringify({ type: 'authorize', token: grant.token })) }
        catch { fail('Streaming could not connect. Your recording will be transcribed after submission.') }
      }
      socket.onerror = socket.onclose = () => fail('Streaming disconnected. Your recording will be transcribed after submission.')
      socket.onmessage = event => {
        if (ended) return
        try {
          if (typeof event.data !== 'string' || event.data.length > 65_536) throw new Error('Invalid streaming response')
          const message = JSON.parse(event.data)
          if (message.type === 'ready' && !ready) {
            ready = true; clearTimeout(deadline)
            deadline = setTimeout(() => fail('Streaming capture timed out. Your recording will be transcribed after submission.'), 125_000)
            for (const frame of queued) send(frame)
            queued = []; queuedBytes = 0
            if (stopping) commit()
          } else if (message.type === 'partial' && typeof message.text === 'string' && message.text.length <= 4_000) {
            callbacks.text(message.text)
          } else if (message.type === 'final' && committed && message.captureId === captureId && typeof message.text === 'string' && message.text.trim() && message.text.length <= 4_000) {
            callbacks.text(message.text.trim()); complete(message.text.trim())
          } else if (message.type === 'error' || message.type === 'final') {
            fail('Streaming did not produce a usable transcript. Your recording will be transcribed after submission.')
          }
        } catch { fail('Streaming returned an invalid response. Your recording will be transcribed after submission.') }
      }
    }).catch(() => fail('Streaming could not be authorized. Your recording will be transcribed after submission.'))
  } catch { fail('This browser cannot stream audio. Your recording will be transcribed after submission.') }
  return {
    finish() {
      if (!stopping && !ended) {
        stopping = true; disconnectAudio()
        try { commit() } catch { fail('Streaming disconnected. Your recording will be transcribed after submission.') }
      }
      return result
    },
    cancel() { complete(null) },
  }
}
