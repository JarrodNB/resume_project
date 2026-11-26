/** Notice when a candidate stops talking, or starts again, for hands-free interview answers.
 * Loudness comes from the microphone the recorder already opened (no second permission prompt),
 * through a Web Audio analyser; nothing is recorded or sent from here. The timers take any level
 * source, so tests can drive them with plain numbers and fake timers instead of real audio.
 */

/** Loudness (RMS of samples between -1 and 1) below this counts as silence. */
export const SILENCE_LEVEL = 0.01
const CHECK_EVERY_MS = 100
/** Sound must last this long to count as speech, so a click or bump is ignored. */
const SPEECH_MS = 300

interface WatchOptions {
  /** Current loudness, or null when it cannot be read (never counted as silence). */
  readLevel: () => number | null
  silenceMs: number
  onEndOfSpeech: () => void
}

/** Call onEndOfSpeech once, after silenceMs of continuous quiet. Returns a function that stops watching. */
export function watchForEndOfSpeech({ readLevel, silenceMs, onEndOfSpeech }: WatchOptions) {
  let quietSince: number | null = Date.now()
  const timer = setInterval(() => {
    const level = readLevel()
    if (level === null || level >= SILENCE_LEVEL) { quietSince = null; return }
    quietSince ??= Date.now()
    if (Date.now() - quietSince >= silenceMs) { clearInterval(timer); onEndOfSpeech() }
  }, CHECK_EVERY_MS)
  return () => clearInterval(timer)
}

/** Call onSpeech once, after SPEECH_MS of continuous sound. Returns a function that stops watching. */
export function watchForSpeech({ readLevel, onSpeech }: { readLevel: () => number | null; onSpeech: () => void }) {
  let loudReadings = 0
  const timer = setInterval(() => {
    const level = readLevel()
    loudReadings = level !== null && level >= SILENCE_LEVEL ? loudReadings + 1 : 0
    if (loudReadings * CHECK_EVERY_MS >= SPEECH_MS) { clearInterval(timer); onSpeech() }
  }, CHECK_EVERY_MS)
  return () => clearInterval(timer)
}

/** Measure the loudness of a live microphone stream.
 * Pausing a recording mutes the recorder's own tracks, so this listens to switched-on copies of
 * them instead. That way speech is still heard during the auto-send countdown. The copies come
 * from the microphone that is already open and are stopped by close().
 * Returns null when the browser has no Web Audio. */
export function openMicrophoneLevel(stream: MediaStream): { readLevel: () => number | null; close: () => void } | null {
  const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) return null
  const context = new AudioContextClass()
  // A suspended context reads as silence, so try to run it and report no level until it does.
  if (context.state === 'suspended') void context.resume().catch(() => {})
  const tracks = stream.getAudioTracks().map((track) => {
    const copy = track.clone()
    copy.enabled = true
    return copy
  })
  const source = context.createMediaStreamSource(new MediaStream(tracks))
  const analyser = context.createAnalyser()
  analyser.fftSize = 2048
  source.connect(analyser)
  const samples = new Float32Array(analyser.fftSize)
  return {
    readLevel() {
      if (context.state !== 'running') return null
      analyser.getFloatTimeDomainData(samples)
      return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)
    },
    close() {
      source.disconnect()
      void context.close().catch(() => {})
      tracks.forEach((track) => track.stop())
    },
  }
}
