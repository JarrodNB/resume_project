/** Check microphone recording through the hook's user-facing state and actions. */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useInterviewRecorder } from './useInterviewRecorder'

class FakeRecorder {
  static isTypeSupported = vi.fn(() => true)
  static latest: FakeRecorder
  static options: MediaRecorderOptions | undefined
  mimeType = 'audio/webm;codecs=opus'
  state = 'inactive'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(_stream: MediaStream, options?: MediaRecorderOptions) { FakeRecorder.latest = this; FakeRecorder.options = options }
  pauseListener: (() => void) | undefined
  addEventListener(_event: string, callback: () => void) { this.pauseListener = callback }
  pause() { this.state = 'paused'; this.pauseListener?.() }
  resume() { this.state = 'recording' }
  requestData() { this.chunk(new Blob([])) }
  start() { this.state = 'recording' }
  stop() { this.state = 'inactive'; this.onstop?.() }
  chunk(data: Blob) { this.ondataavailable?.({ data }) }
}

describe('useInterviewRecorder', () => {
  let stopTrack: ReturnType<typeof vi.fn>
  let stream: MediaStream
  let ended: (() => void) | undefined
  beforeEach(() => {
    vi.useFakeTimers()
    stopTrack = vi.fn()
    ended = undefined
    stream = { getAudioTracks: () => [], getTracks: () => [{ stop: stopTrack, addEventListener: (_event: string, callback: () => void) => { ended = callback } }] } as unknown as MediaStream
    vi.stubGlobal('MediaRecorder', FakeRecorder)
    FakeRecorder.isTypeSupported.mockReturnValue(true)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue(stream) } })
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('keeps recording until Done, then returns the actual MIME and stops tracks', async () => {
    const { result } = renderHook(useInterviewRecorder)
    await act(() => result.current.start())
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: {
      channelCount: { ideal: 1 },
      echoCancellation: { ideal: true },
      noiseSuppression: { ideal: true },
      autoGainControl: { ideal: true },
    } })
    expect(FakeRecorder.options?.audioBitsPerSecond).toBe(128_000)
    act(() => FakeRecorder.latest.chunk(new Blob(['answer'])))
    expect(result.current.status).toBe('recording')
    expect(result.current.recording).toBeNull()
    act(() => result.current.stop())
    expect(result.current.status).toBe('ready')
    expect(result.current.recording?.type).toBe('audio/webm;codecs=opus')
    expect(result.current.recording?.size).toBe(6)
    expect(stopTrack).not.toHaveBeenCalled()
    act(() => result.current.reset())
    expect(stopTrack).toHaveBeenCalled()
    expect(result.current.recording).toBeNull()
    expect(result.current.status).toBe('idle')
  })

  it('shares the open microphone stream while capture is alive, for end-of-speech detection', async () => {
    const { result } = renderHook(useInterviewRecorder)
    expect(result.current.microphoneStream()).toBeNull()
    await act(() => result.current.start())
    expect(result.current.microphoneStream()).toBe(stream)
    act(() => result.current.reset())
    expect(result.current.microphoneStream()).toBeNull()
  })

  it.each(['browser', 'streaming', 'recorded'] as const)('continues the same audio container in %s mode without counting paused time', async (mode) => {
    vi.stubGlobal('SpeechRecognition', class { onend?: () => void; start() {} stop() { this.onend?.() } abort() {} })
    const startStreaming = vi.fn(() => ({ finish: async () => 'spoken words', cancel: vi.fn() }))
    const { result } = renderHook(() => useInterviewRecorder({ mode, startStreaming }))
    await act(() => result.current.start())
    const original = FakeRecorder.latest
    act(() => { original.chunk(new Blob(['first'])); vi.advanceTimersByTime(60_000) })
    await act(async () => result.current.stop())
    expect(result.current.status).toBe('ready')
    act(() => vi.advanceTimersByTime(180_000))
    expect(result.current.error).toBeNull()
    act(() => result.current.resume())
    expect(FakeRecorder.latest).toBe(original)
    expect(result.current.recording).toBeNull()
    act(() => original.chunk(new Blob(['second'])))
    await act(async () => result.current.stop())
    expect(result.current.recording?.size).toBe(11)
    act(() => result.current.resume())
    act(() => vi.advanceTimersByTime(60_000))
    expect(result.current.error).toMatch(/2 minutes/)
  })

  it('discards recordings at the time and size limits', async () => {
    const { result } = renderHook(useInterviewRecorder)
    await act(() => result.current.start())
    act(() => { FakeRecorder.latest.chunk(new Blob(['answer'])); vi.advanceTimersByTime(120_000) })
    expect(result.current.recording).toBeNull()
    expect(result.current.error).toMatch(/2 minutes/)
    expect(stopTrack).toHaveBeenCalled()
    await act(() => result.current.start())
    act(() => FakeRecorder.latest.chunk(new Blob([new Uint8Array(10 * 1024 * 1024)])))
    expect(result.current.recording).toBeNull()
    expect(result.current.error).toMatch(/10 MiB/)
  })

  it('releases a pending microphone permission result after unmount', async () => {
    let resolve!: (value: MediaStream) => void
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(new Promise((done) => { resolve = done }))
    const { result, unmount } = renderHook(useInterviewRecorder)
    let pending!: Promise<void>
    act(() => { pending = result.current.start() })
    unmount()
    await act(async () => { resolve(stream); await pending })
    expect(stopTrack).toHaveBeenCalled()
  })

  it('discards a recording when the device disconnects and releases active tracks on unmount', async () => {
    const { result, unmount } = renderHook(useInterviewRecorder)
    await act(() => result.current.start())
    act(() => ended?.())
    expect(result.current.error).toMatch(/disconnected/i)
    expect(result.current.recording).toBeNull()
    expect(stopTrack).toHaveBeenCalled()
    await act(() => result.current.start())
    stopTrack.mockClear()
    unmount()
    expect(stopTrack).toHaveBeenCalled()
  })

  it('shows permission, unsupported format, empty recording and recorder failures', async () => {
    const { result } = renderHook(useInterviewRecorder)
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(new Error('denied'))
    await act(() => result.current.start())
    expect(result.current.error).toMatch(/microphone/i)
    FakeRecorder.isTypeSupported.mockReturnValue(false)
    await act(() => result.current.start())
    expect(result.current.error).toMatch(/format/i)
    FakeRecorder.isTypeSupported.mockReturnValue(true)
    await act(() => result.current.start())
    act(() => result.current.stop())
    expect(result.current.error).toMatch(/empty/i)
    await act(() => result.current.start())
    act(() => FakeRecorder.latest.onerror?.())
    expect(result.current.error).toMatch(/recording failed/i)
    expect(stopTrack).toHaveBeenCalled()
  })

  it('releases the device when MediaRecorder cannot start', async () => {
    const start = vi.spyOn(FakeRecorder.prototype, 'start').mockImplementationOnce(() => { throw new Error('device unavailable') })
    const { result } = renderHook(useInterviewRecorder)
    await act(() => result.current.start())
    expect(result.current.status).toBe('idle')
    expect(result.current.error).toMatch(/microphone/i)
    expect(stopTrack).toHaveBeenCalled()
    start.mockRestore()
  })

  it('discards pending permissions on reset and ignores late recording events', async () => {
    let resolve!: (value: MediaStream) => void
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const { result } = renderHook(useInterviewRecorder)
    let pending!: Promise<void>
    act(() => { pending = result.current.start() })
    act(() => result.current.reset())
    await act(async () => { resolve(stream); await pending })
    expect(stopTrack).toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
    await act(() => result.current.start())
    const recorder = FakeRecorder.latest
    act(() => result.current.reset())
    act(() => { recorder.chunk(new Blob(['late'])); recorder.onstop?.() })
    expect(result.current.status).toBe('idle')
    expect(result.current.recording).toBeNull()
  })
})

describe('recording with live transcription', () => {
  it('automatically pauses on live failure, retaining audio and displayed words, and can resume', async () => {
    const track = { enabled: true, stop: vi.fn(), addEventListener: vi.fn() }
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream
    vi.stubGlobal('MediaRecorder', FakeRecorder)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue(stream) } })
    let callbacks!: import('./transcriptionCapture').TranscriptionCallbacks
    const finish = vi.fn().mockResolvedValue(null)
    const startStreaming = vi.fn((_stream, next) => { callbacks = next; return { finish, cancel: vi.fn() } })
    const { result, unmount } = renderHook(() => useInterviewRecorder({ mode: 'streaming', startStreaming }))
    await act(() => result.current.start())
    act(() => { FakeRecorder.latest.chunk(new Blob(['retained audio'])); callbacks.text('Words so far') })
    await act(async () => callbacks.fallback('Live transcription sent back something unexpected.'))
    expect(FakeRecorder.latest.state).toBe('paused')
    expect(track.enabled).toBe(false)
    expect(track.stop).not.toHaveBeenCalled()
    expect(result.current.status).toBe('ready')
    expect(result.current.recording?.size).toBe(14)
    expect(result.current.transcript).toBe('Words so far')
    expect(result.current.candidateTranscript).toBeNull()
    expect(result.current.fallbackReason).toMatch(/unexpected/)
    expect(finish).toHaveBeenCalledOnce()
    expect(result.current.liveFailed).toBe(true)
    const previous = callbacks
    act(() => result.current.resume())
    await act(async () => { previous.text('Late words'); previous.fallback('Late failure') })
    expect(result.current.transcript).toBe('')
    expect(FakeRecorder.latest.state).toBe('recording')
    expect(track.enabled).toBe(true)
    expect(result.current.fallbackReason).toBeNull()
    expect(result.current.effectiveMode).toBe('streaming')
    expect(startStreaming).toHaveBeenCalledTimes(2)
    // The earlier segment's live words may be incomplete, so the recording still needs transcribing.
    expect(result.current.liveFailed).toBe(true)
    unmount(); vi.unstubAllGlobals()
  })

  it('retains audio and visibly falls back when browser recognition is unsupported', async () => {
    const stopTrack = vi.fn()
    const stream = { getAudioTracks: () => [], getTracks: () => [{ stop: stopTrack, addEventListener: vi.fn() }] } as unknown as MediaStream
    vi.stubGlobal('MediaRecorder', FakeRecorder)
    vi.stubGlobal('SpeechRecognition', undefined)
    vi.stubGlobal('webkitSpeechRecognition', undefined)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue(stream) } })
    const flush = vi.spyOn(FakeRecorder.prototype, 'requestData').mockImplementationOnce(function (this: FakeRecorder) { this.chunk(new Blob(['complete recording'])) })
    const { result, unmount } = renderHook(() => useInterviewRecorder({ mode: 'browser' }))
    await act(() => result.current.start())
    expect(result.current.effectiveMode).toBe('recorded')
    expect(result.current.fallbackReason).toMatch(/doesn.t support/)
    await act(async () => result.current.stop())
    expect(result.current.status).toBe('ready')
    expect(result.current.recording?.size).toBe(18)
    expect(result.current.candidateTranscript).toBeNull()
    expect(FakeRecorder.latest.state).toBe('paused')
    flush.mockRestore()
    unmount(); vi.unstubAllGlobals()
  })
  it('waits for recognition finalization before review and ignores completion after discard', async () => {
    const stream = { getAudioTracks: () => [], getTracks: () => [{ stop: vi.fn(), addEventListener: vi.fn() }] } as unknown as MediaStream
    vi.stubGlobal('MediaRecorder', FakeRecorder)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue(stream) } })
    let resolve!: (text: string | null) => void
    const cancel = vi.fn()
    const startStreaming = vi.fn(() => ({ finish: () => new Promise<string | null>((done) => { resolve = done }), cancel }))
    const { result, unmount } = renderHook(() => useInterviewRecorder({ mode: 'streaming', startStreaming }))
    await act(() => result.current.start())
    act(() => FakeRecorder.latest.chunk(new Blob(['audio'])))
    act(() => result.current.stop())
    expect(result.current.status).toBe('finalizing')
    expect(result.current.recording).toBeNull()
    await act(async () => { resolve('Final streamed answer.') })
    expect(result.current.status).toBe('ready')
    expect(result.current.candidateTranscript).toBe('Final streamed answer.')
    await act(() => result.current.start())
    act(() => { FakeRecorder.latest.chunk(new Blob(['audio'])); result.current.stop(); result.current.reset() })
    await act(async () => { resolve('Stale answer.') })
    expect(result.current.status).toBe('idle')
    expect(result.current.candidateTranscript).toBeNull()
    expect(cancel).toHaveBeenCalled()
    unmount(); vi.unstubAllGlobals()
  })
})
