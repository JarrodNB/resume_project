/** Check that end-of-speech detection waits for continuous quiet and fires only once. */
import { afterEach, expect, it, vi } from 'vitest'
import { openMicrophoneLevel, watchForEndOfSpeech } from './endOfSpeech'

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

it('reads loudness from the microphone stream and releases the audio graph', () => {
  const close = vi.fn(() => Promise.resolve())
  const disconnect = vi.fn()
  let amplitude = 0.5
  vi.stubGlobal('AudioContext', class {
    state = 'running'
    close = close
    resume = vi.fn(() => Promise.resolve())
    createMediaStreamSource() { return { connect: vi.fn(), disconnect } }
    createAnalyser() { return { fftSize: 32, getFloatTimeDomainData(target: Float32Array) { target.forEach((_, index) => { target[index] = index % 2 ? -amplitude : amplitude }) } } }
  })
  const microphone = openMicrophoneLevel({} as MediaStream)!
  expect(microphone.readLevel()).toBeCloseTo(0.5)
  amplitude = 0
  expect(microphone.readLevel()).toBe(0)
  microphone.close()
  expect(disconnect).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledOnce()
})

it('offers no level when the browser has no Web Audio', () => {
  vi.stubGlobal('AudioContext', undefined)
  expect(openMicrophoneLevel({} as MediaStream)).toBeNull()
})
