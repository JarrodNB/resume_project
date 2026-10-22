/** Recognize one answer while a separate MediaRecorder retains the complete audio.
 * Final results replace their indexed slots; interim words are never submitted. A bounded
 * stop waits for final callbacks. Failure selects recorded fallback rather than partial text.
 */
export interface TranscriptionCallbacks { text(text: string): void; fallback(reason: string): void }
export interface TranscriptionCapture { finish(): Promise<string | null>; cancel(): void }
export type TranscriptionMode = 'browser' | 'streaming' | 'recorded'
interface Result { isFinal: boolean; [index: number]: { transcript: string } }
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number
  onresult: ((event: { resultIndex: number; results: ArrayLike<Result> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void; stop(): void; abort(): void
}
export function startBrowserTranscription(callbacks: TranscriptionCallbacks): TranscriptionCapture {
  const factory = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition })
  const Constructor = factory.SpeechRecognition ?? factory.webkitSpeechRecognition
  let active = true, stopping = false, failed = false, restarts = 0
  let current: Recognition | null = null, completed = ''
  let slots = new Map<number, { text: string; final: boolean }>()
  let restartTimer: ReturnType<typeof setTimeout> | undefined, deadline: ReturnType<typeof setTimeout> | undefined
  let finishPromise: Promise<string | null> | undefined, resolveFinish: ((text: string | null) => void) | undefined
  const finalText = () => [completed, ...[...slots.entries()].sort(([a], [b]) => a - b).filter(([, slot]) => slot.final).map(([, slot]) => slot.text)].filter(Boolean).join(' ').trim()
  const detach = () => {
    clearTimeout(restartTimer); clearTimeout(deadline)
    if (current) { current.onresult = null; current.onend = null; current.onerror = null; try { current.abort() } catch { /* already stopped */ } }
    current = null
  }
  const settle = () => {
    if (!failed && [...slots.values()].some((slot) => !slot.final && slot.text)) {
      failed = true; callbacks.fallback('Recognition ended with unfinished words. Your recording is kept. Finish recording, then choose Transcribe recording.')
    }
    const text = finalText()
    if (!failed && !text) { failed = true; callbacks.fallback('No final recognition text was available. Your recording is kept. Finish recording, then choose Transcribe recording.') }
    active = false; detach(); resolveFinish?.(failed ? null : text)
  }
  const fail = (reason: string) => {
    if (!active || failed) return
    failed = true; callbacks.fallback(reason)
    if (stopping) settle()
    else detach()
  }
  const start = () => {
    if (!active || failed || stopping || !Constructor) return
    const rec = new Constructor()
    current = rec; slots = new Map()
    rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1
    rec.onresult = (event) => {
      if (!active || current !== rec || failed) return
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index]
        slots.set(index, { text: result[0].transcript.trim(), final: result.isFinal })
      }
      const display = [completed, ...[...slots.entries()].sort(([a], [b]) => a - b).map(([, slot]) => slot.text)].filter(Boolean).join(' ')
      if (display.length > 4000) { fail('Recognition text exceeded the answer limit. Your recording is kept. Finish recording, then choose Transcribe recording.'); return }
      callbacks.text(display)
    }
    rec.onerror = ({ error }) => {
      if (!active || current !== rec || failed) return
      if (error === 'no-speech') return
      fail(error === 'not-allowed' || error === 'service-not-allowed'
        ? 'Browser recognition permission was denied. If microphone recording succeeds, finish recording, then choose Transcribe recording.'
        : 'Browser recognition failed. Your recording is kept. Finish recording, then choose Transcribe recording.')
    }
    rec.onend = () => {
      if (!active || current !== rec || failed) return
      if (stopping) { settle(); return }
      if ([...slots.values()].some((slot) => !slot.final && slot.text)) { fail('Recognition was interrupted before words finalized. Your recording is kept. Finish recording, then choose Transcribe recording.'); return }
      // Each restarted recognizer gets fresh indexed results; preserve only completed slots.
      completed = finalText(); slots.clear()
      rec.onresult = null; rec.onend = null; rec.onerror = null
      if (++restarts > 12) { fail('Browser recognition stopped repeatedly. Your recording is kept. Finish recording, then choose Transcribe recording.'); return }
      restartTimer = setTimeout(start, 250)
    }
    try { rec.start() } catch { fail('Browser recognition could not start. Your recording is kept. Finish recording, then choose Transcribe recording.') }
  }
  if (Constructor) start()
  else fail('Browser recognition is unavailable. Your recording is kept. Finish recording, then choose Transcribe recording.')
  return {
    finish() {
      if (finishPromise) return finishPromise
      finishPromise = new Promise((resolve) => { resolveFinish = resolve })
      stopping = true; clearTimeout(restartTimer)
      if (failed || !current) settle()
      else {
        deadline = setTimeout(() => { fail('Browser recognition did not finalize. Your recording is kept. Finish recording, then choose Transcribe recording.') }, 1500)
        try { current.stop() } catch { fail('Browser recognition could not finalize. Your recording is kept. Finish recording, then choose Transcribe recording.') }
      }
      return finishPromise
    },
    cancel() { active = false; failed = true; detach(); resolveFinish?.(null) },
  }
}
