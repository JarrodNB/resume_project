/** Exercise recognition as a capture: final text is stable and failures retain recorded fallback. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startBrowserTranscription } from './transcriptionCapture'

class Recognizer {
  static latest: Recognizer
  onresult?: (event: unknown) => void
  onend?: () => void
  onerror?: (event: { error: string }) => void
  start = vi.fn()
  stop = vi.fn()
  abort = vi.fn()
  constructor() { Recognizer.latest = this }
  result(text: string, final: boolean) { this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: final })] }) }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('browser transcription capture', () => {
  it('replaces interim results and deduplicates final results before bounded finalization', async () => {
    vi.stubGlobal('SpeechRecognition', Recognizer)
    const text = vi.fn(), fallback = vi.fn()
    const capture = startBrowserTranscription({ text, fallback })
    Recognizer.latest.result('I improved', false)
    Recognizer.latest.result('I improved response time.', true)
    Recognizer.latest.result('I improved response time.', true)
    const final = capture.finish()
    Recognizer.latest.onend?.()
    expect(await final).toBe('I improved response time.')
    expect(text).toHaveBeenLastCalledWith('I improved response time.')
    expect(fallback).not.toHaveBeenCalled()
  })
  it('falls back on unsupported recognition, errors and missing finalization without submitting interim text', async () => {
    const fallback = vi.fn()
    vi.stubGlobal('SpeechRecognition', undefined)
    expect(await startBrowserTranscription({ text: vi.fn(), fallback }).finish()).toBeNull()
    expect(fallback).toHaveBeenCalledWith(expect.stringMatching(/unavailable/))
    expect(fallback).toHaveBeenLastCalledWith(expect.stringContaining('choose Transcribe recording'))
    vi.stubGlobal('SpeechRecognition', Recognizer)
    vi.useFakeTimers()
    const capture = startBrowserTranscription({ text: vi.fn(), fallback })
    Recognizer.latest.result('interim only', false)
    const final = capture.finish()
    await vi.advanceTimersByTimeAsync(1500)
    expect(await final).toBeNull()
    expect(fallback).toHaveBeenLastCalledWith(expect.stringMatching(/did not finalize/))
  })
  it('keeps completed words across restarts, ignores late callbacks and cancels finalization', async () => {
    vi.stubGlobal('SpeechRecognition', Recognizer)
    vi.useFakeTimers()
    const text = vi.fn(), fallback = vi.fn()
    const capture = startBrowserTranscription({ text, fallback })
    const first = Recognizer.latest
    first.result('First sentence.', true)
    const late = first.onresult
    first.onend?.()
    await vi.advanceTimersByTimeAsync(250)
    Recognizer.latest.result('Second sentence.', true)
    late?.({ resultIndex: 0, results: [Object.assign([{ transcript: 'stale' }], { isFinal: true })] })
    const final = capture.finish()
    Recognizer.latest.onend?.()
    expect(await final).toBe('First sentence. Second sentence.')
    const another = startBrowserTranscription({ text, fallback })
    const pending = another.finish()
    another.cancel()
    expect(await pending).toBeNull()
  })
})

it('falls back rather than silently dropping unfinished words after completed text', async () => {
  vi.stubGlobal('SpeechRecognition', Recognizer)
  const fallback = vi.fn()
  const capture = startBrowserTranscription({ text: vi.fn(), fallback })
  Recognizer.latest.onresult?.({ resultIndex: 0, results: [
    Object.assign([{ transcript: 'Finished clause.' }], { isFinal: true }),
    Object.assign([{ transcript: 'unfinished remainder' }], { isFinal: false }),
  ] })
  const final = capture.finish()
  Recognizer.latest.onend?.()
  expect(await final).toBeNull()
  expect(fallback).toHaveBeenCalledWith(expect.stringMatching(/unfinished/))
})
