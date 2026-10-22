/** Exercise streamed answer capture through its browser adapter with fake audio and sockets. */
import { describe, expect, it, vi } from 'vitest'
import { Pcm24Encoder, startStreamingTranscription } from './streamingTranscription'

describe('streaming transcription', () => {
  it('resamples continuous microphone buffers to little-endian mono PCM24', () => {
    const encoder = new Pcm24Encoder(48_000)
    const first = encoder.encode(new Float32Array([1, 0, -1, 0]))
    const second = encoder.encode(new Float32Array([0.5, 0, -0.5, 0]))
    expect([...new Int16Array(first)]).toEqual([32767, -32768])
    expect([...new Int16Array(second)]).toEqual([16383, -16384])
  })

  it('keeps early audio, authorizes before sending it, commits once, and waits for a durable final', async () => {
    const setup = fixture()
    const capture = startStreamingTranscription({} as MediaStream, setup.callbacks, setup.authorize, setup.dependencies)
    await vi.waitFor(() => expect(setup.socket.onopen).toBeTypeOf('function'))
    setup.socket.onopen!({} as Event)
    expect(setup.socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'authorize', token: 'secret' }))
    setup.process(new Float32Array([0.5, 0.5, 0.5, 0.5]))
    expect(setup.socket.send).toHaveBeenCalledTimes(1)
    setup.message({ type: 'ready' })
    expect(setup.socket.send.mock.calls[1][0]).toBeInstanceOf(ArrayBuffer)
    const completed = capture.finish()
    const again = capture.finish()
    expect(again).toBe(completed)
    expect(setup.socket.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'commit' }))
    setup.message({ type: 'partial', text: 'Hello' })
    setup.message({ type: 'final', text: 'Hello there', captureId: 'capture' })
    expect(await completed).toBe('Hello there')
    expect(setup.closeAudio).toHaveBeenCalled()
    expect(setup.callbacks.text).toHaveBeenLastCalledWith('Hello there')
  })

  it('falls back on disconnect and ignores final text after cancellation', async () => {
    const setup = fixture()
    const capture = startStreamingTranscription({} as MediaStream, setup.callbacks, setup.authorize, setup.dependencies)
    await vi.waitFor(() => expect(setup.socket.onopen).toBeTypeOf('function'))
    setup.socket.onclose!({} as CloseEvent)
    expect(await capture.finish()).toBeNull()
    expect(setup.callbacks.fallback).toHaveBeenCalledOnce()
    setup.message({ type: 'final', text: 'Late', captureId: 'capture' })
    expect(setup.callbacks.text).not.toHaveBeenCalled()
  })

  it('does not open a socket after a cancelled authorization', async () => {
    const setup = fixture()
    let resolve!: (value: {captureId:string;token:string}) => void
    const authorize = () => new Promise<{captureId:string;token:string}>(done => { resolve = done })
    const capture = startStreamingTranscription({} as MediaStream, setup.callbacks, authorize, setup.dependencies)
    capture.cancel()
    resolve({ captureId: 'capture', token: 'secret' })
    await Promise.resolve()
    expect(setup.dependencies.socket).not.toHaveBeenCalled()
    expect(await capture.finish()).toBeNull()
  })

  it('falls back after bounded finalization without accepting provisional text', async () => {
    const setup = fixture()
    const capture = startStreamingTranscription({} as MediaStream, setup.callbacks, setup.authorize, setup.dependencies)
    await vi.waitFor(() => expect(setup.socket.onopen).toBeTypeOf('function'))
    setup.socket.onopen!({} as Event)
    setup.message({ type: 'ready' })
    setup.message({ type: 'partial', text: 'unfinished' })
    vi.useFakeTimers()
    try {
      const final = capture.finish()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(await final).toBeNull()
      expect(setup.callbacks.fallback).toHaveBeenCalledOnce()
    } finally { vi.useRealTimers() }
  })

  it('falls back rather than dropping microphone samples when the connection backs up', async () => {
    const setup = fixture()
    const capture = startStreamingTranscription({} as MediaStream, setup.callbacks, setup.authorize, setup.dependencies)
    await vi.waitFor(() => expect(setup.socket.onopen).toBeTypeOf('function'))
    setup.socket.onopen!({} as Event)
    setup.message({ type: 'ready' })
    setup.socket.bufferedAmount = 300_000
    setup.process(new Float32Array([0.5, 0.5, 0.5, 0.5]))
    expect(await capture.finish()).toBeNull()
    expect(setup.callbacks.fallback).toHaveBeenCalledOnce()
  })

  it('resamples identically when browser buffer boundaries change', () => {
    const samples = Float32Array.from({ length: 100 }, (_, index) => Math.sin(index / 5))
    const together = new Uint8Array(new Pcm24Encoder(44_100).encode(samples))
    const encoder = new Pcm24Encoder(44_100)
    const split = [samples.slice(0, 17), samples.slice(17, 49), samples.slice(49)].map(part => new Uint8Array(encoder.encode(part)))
    expect(split.flatMap(part => [...part])).toEqual([...together])
  })
})

function fixture() {
  const socket = { readyState: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn(), onopen: null as ((event: Event) => void) | null, onmessage: null as ((event: MessageEvent) => void) | null, onclose: null as ((event: CloseEvent) => void) | null, onerror: null as ((event: Event) => void) | null }
  const processor = { onaudioprocess: null as ((event: AudioProcessingEvent) => void) | null, connect: vi.fn(), disconnect: vi.fn() }
  const source = { connect: vi.fn(), disconnect: vi.fn() }
  const closeAudio = vi.fn().mockResolvedValue(undefined)
  const audio = { sampleRate: 48_000, destination: {}, createMediaStreamSource: () => source, createScriptProcessor: () => processor, close: closeAudio, resume: vi.fn().mockResolvedValue(undefined) }
  return {
    socket, closeAudio,
    callbacks: { text: vi.fn(), fallback: vi.fn() },
    authorize: vi.fn().mockResolvedValue({ captureId: 'capture', token: 'secret' }),
    dependencies: { audio: () => audio as unknown as AudioContext, socket: vi.fn(() => socket as unknown as WebSocket) },
    process: (samples: Float32Array) => processor.onaudioprocess!({ inputBuffer: { getChannelData: () => samples } } as unknown as AudioProcessingEvent),
    message: (value: unknown) => socket.onmessage?.({ data: JSON.stringify(value) } as MessageEvent),
  }
}
