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
    stream = { getTracks: () => [{ stop: stopTrack, addEventListener: (_event: string, callback: () => void) => { ended = callback } }] } as unknown as MediaStream
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
    expect(stopTrack).toHaveBeenCalled()
    act(() => result.current.reset())
    expect(result.current.recording).toBeNull()
    expect(result.current.status).toBe('idle')
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
  it('retains audio and visibly falls back when browser recognition is unsupported', async () => {
    const stopTrack = vi.fn()
    const stream = { getTracks: () => [{ stop: stopTrack, addEventListener: vi.fn() }] } as unknown as MediaStream
    vi.stubGlobal('MediaRecorder', FakeRecorder)
    vi.stubGlobal('SpeechRecognition', undefined)
    vi.stubGlobal('webkitSpeechRecognition', undefined)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue(stream) } })
    const { result, unmount } = renderHook(() => useInterviewRecorder({ mode: 'browser' }))
    await act(() => result.current.start())
    act(() => FakeRecorder.latest.chunk(new Blob(['complete recording'])))
    expect(result.current.effectiveMode).toBe('recorded')
    expect(result.current.fallbackReason).toMatch(/unavailable/)
    await act(async () => result.current.stop())
    expect(result.current.status).toBe('ready')
    expect(result.current.recording?.size).toBe(18)
    expect(result.current.candidateTranscript).toBeNull()
    unmount(); vi.unstubAllGlobals()
  })
  it('waits for recognition finalization before review and ignores completion after discard', async () => {
    const stream = { getTracks: () => [{ stop: vi.fn(), addEventListener: vi.fn() }] } as unknown as MediaStream
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
