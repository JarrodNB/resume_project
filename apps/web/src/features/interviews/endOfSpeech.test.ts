/** Check that end-of-speech detection waits for continuous quiet, speech detection waits for a
 * short sustained sound, and each fires only once. */
import { afterEach, expect, it, vi } from 'vitest'
import { openMicrophoneLevel, watchForEndOfSpeech, watchForSpeech } from './endOfSpeech'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('fires once after continuous silence and restarts the wait whenever the candidate speaks', () => {
  vi.useFakeTimers()
  let level: number | null = 0
  const onEndOfSpeech = vi.fn()
  watchForEndOfSpeech({ readLevel: () => level, silenceMs: 2_500, onEndOfSpeech })
  vi.advanceTimersByTime(2_000)
  level = 0.2
  vi.advanceTimersByTime(200)
  level = null // An unreadable level is never treated as silence.
  vi.advanceTimersByTime(3_000)
  level = 0
  vi.advanceTimersByTime(2_000)
  expect(onEndOfSpeech).not.toHaveBeenCalled()
  vi.advanceTimersByTime(600)
  expect(onEndOfSpeech).toHaveBeenCalledOnce()
  vi.advanceTimersByTime(10_000)
  expect(onEndOfSpeech).toHaveBeenCalledOnce()
})

it('stops watching when cancelled', () => {
  vi.useFakeTimers()
  const onEndOfSpeech = vi.fn()
  const cancel = watchForEndOfSpeech({ readLevel: () => 0, silenceMs: 2_500, onEndOfSpeech })
  vi.advanceTimersByTime(1_000)
  cancel()
  vi.advanceTimersByTime(10_000)
  expect(onEndOfSpeech).not.toHaveBeenCalled()
})

it('notices speech once the level stays loud briefly, ignoring a single click', () => {
  vi.useFakeTimers()
  let level: number | null = 0.2
  const onSpeech = vi.fn()
  const cancel = watchForSpeech({ readLevel: () => level, onSpeech })
  vi.advanceTimersByTime(100)
  level = 0
  vi.advanceTimersByTime(1_000)
  level = null
  vi.advanceTimersByTime(1_000)
  expect(onSpeech).not.toHaveBeenCalled()
  level = 0.2
  vi.advanceTimersByTime(300)
  expect(onSpeech).toHaveBeenCalledOnce()
  vi.advanceTimersByTime(1_000)
  expect(onSpeech).toHaveBeenCalledOnce()
  cancel()
})

it('reads loudness from its own live copy of the microphone, even while recording is paused, and releases it', () => {
  const close = vi.fn(() => Promise.resolve())
  const disconnect = vi.fn()
  let amplitude = 0.5
  let measured: MediaStream | undefined
  vi.stubGlobal('MediaStream', class { constructor(public tracks: MediaStreamTrack[]) {} getAudioTracks() { return this.tracks } })
  vi.stubGlobal('AudioContext', class {
    state = 'running'
    close = close
    resume = vi.fn(() => Promise.resolve())
    createMediaStreamSource(stream: MediaStream) { measured = stream; return { connect: vi.fn(), disconnect } }
    createAnalyser() { return { fftSize: 32, getFloatTimeDomainData(target: Float32Array) { target.forEach((_, index) => { target[index] = index % 2 ? -amplitude : amplitude }) } } }
  })
  const copy = { enabled: false, stop: vi.fn() }
  // A paused recording mutes its own track; the copy is switched on so speech can still be heard.
  const recorderTrack = { enabled: false, stop: vi.fn(), clone: () => ({ ...copy }) }
  const microphone = openMicrophoneLevel({ getAudioTracks: () => [recorderTrack] } as unknown as MediaStream)!
  const [measuredTrack] = measured!.getAudioTracks() as unknown as typeof copy[]
  expect(measuredTrack.enabled).toBe(true)
  expect(microphone.readLevel()).toBeCloseTo(0.5)
  amplitude = 0
  expect(microphone.readLevel()).toBe(0)
  microphone.close()
  expect(disconnect).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledOnce()
  expect(measuredTrack.stop).toHaveBeenCalledOnce()
  expect(recorderTrack.stop).not.toHaveBeenCalled()
  expect(recorderTrack.enabled).toBe(false)
})

it('offers no level when the browser has no Web Audio', () => {
  vi.stubGlobal('AudioContext', undefined)
  expect(openMicrophoneLevel({ getAudioTracks: () => [] } as unknown as MediaStream)).toBeNull()
})
