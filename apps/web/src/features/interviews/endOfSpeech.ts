/** Notice when a candidate has stopped talking, for hands-free interview answers.
 * Loudness comes from the microphone stream the recorder already opened, through a Web Audio
 * analyser; nothing is recorded or sent from here. The silence timer takes any level source,
 * so tests can drive it with plain numbers and fake timers instead of real audio.
 */

/** Loudness (RMS of samples between -1 and 1) below this counts as silence. */
export const SILENCE_LEVEL = 0.01
const CHECK_EVERY_MS = 100

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

/** Measure the loudness of a live microphone stream. Returns null when the browser has no Web Audio. */
export function openMicrophoneLevel(stream: MediaStream): { readLevel: () => number | null; close: () => void } | null {
  const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) return null
  const context = new AudioContextClass()
  // A suspended context reads as silence, so try to run it and report no level until it does.
  if (context.state === 'suspended') void context.resume().catch(() => {})
  const source = context.createMediaStreamSource(stream)
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
    close() { source.disconnect(); void context.close().catch(() => {}) },
  }
}
