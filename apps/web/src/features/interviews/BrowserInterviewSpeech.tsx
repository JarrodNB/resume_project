/** Speak saved interviewer text with the browser's voice engine.
 * One control plays or stops the turn, then disappears once it finishes; recording, navigation and errors
 * release its disposable playback.
 * While `streaming` is set, the text is still being written: only finished sentences are spoken, and playback
 * waits (still counted as playing, so recording stays off) until more text arrives or streaming ends.
 * Browser voices may use device or network services; this never requests provider audio.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { interviewSpeechChunks, selectInterviewVoice } from './browserSpeechDelivery'
import { finishInterviewTiming } from './interviewLatency'

type Props = {
  messageId: string
  text: string
  /** The text may still grow; earlier text never changes while this is set. */
  streaming?: boolean
  automatic?: boolean
  muted?: boolean
  disabled?: boolean
  otherSpeechPlaying?: boolean
  onAutomaticAttempt?: (id: string) => void
  onPlayingChange?: (playing: boolean, id: string) => void
  /** Called when the browser actually starts saying the first sentence of a play. */
  onSpeechStart?: (id: string) => void
}
type Playback = {
  utterance: SpeechSynthesisUtterance | null
  timer: ReturnType<typeof setTimeout> | null
  removeVoiceListener?: () => void
  stop: () => void
  /** Continue after waiting for streamed text; set only while waiting. */
  resume?: () => void
}
// The browser has one queue, including requests waiting for voices to load.
let activePlayback: Playback | null = null

export function BrowserInterviewSpeech(props: Props) {
  return <BrowserSpeech key={props.messageId} {...props} />
}
function BrowserSpeech({ messageId, text, streaming = false, automatic = false, muted = false, disabled = false, otherSpeechPlaying = false, onAutomaticAttempt, onPlayingChange, onSpeechStart }: Props) {
  const supported = Boolean(globalThis.speechSynthesis && globalThis.SpeechSynthesisUtterance)
  const playback = useRef<Playback | null>(null)
  const allowed = useRef(!muted && !disabled)
  const attempted = useRef(false)
  const latest = useRef({ text, streaming })
  const [playing, setPlaying] = useState(false)
  const [ended, setEnded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const notify = useCallback((value: boolean) => onPlayingChange?.(value, messageId), [onPlayingChange, messageId])
  const stop = useCallback(() => {
    const current = playback.current
    playback.current = null
    if (current) {
      if (current.timer) clearTimeout(current.timer)
      current.removeVoiceListener?.()
      if (current.utterance) {
        current.utterance.onstart = null; current.utterance.onend = null; current.utterance.onerror = null
      }
      if (activePlayback === current) {
        activePlayback = null
        if (current.utterance) globalThis.speechSynthesis?.cancel()
      }
    }
    setPlaying(false)
    notify(false)
  }, [notify])
  useEffect(() => {
    allowed.current = !muted && !disabled
    if (!allowed.current || otherSpeechPlaying) stop()
  }, [muted, disabled, otherSpeechPlaying, stop])
  useEffect(() => () => stop(), [stop])
  useEffect(() => {
    latest.current = { text, streaming }
    const waiting = playback.current?.resume
    if (waiting && playback.current) { playback.current.resume = undefined; waiting() }
  }, [text, streaming])
  const play = useCallback((automaticPlay = false) => {
    if (!allowed.current || !supported || !latest.current.text.trim()) return
    stop()
    activePlayback?.stop()
    const current: Playback = { utterance: null, timer: null, stop }
    playback.current = current
    activePlayback = current
    let position = 0
    const live = () => playback.current === current && activePlayback === current && allowed.current
    const fail = () => {
      if (!live()) return
      stop()
      setError('Browser speech did not start or finish. Press Play interviewer audio to try again, or read the question and record your answer.')
    }
    const availableVoices = () => {
      try { return speechSynthesis.getVoices?.() ?? [] } catch { return [] }
    }
    const voice = () => selectInterviewVoice(availableVoices())
    let selectedVoice: SpeechSynthesisVoice | null = null
    const speakNext = () => {
      if (!live()) return
      if (current.timer) clearTimeout(current.timer)
      const chunks = interviewSpeechChunks(latest.current.text)
      // The last chunk of growing text may be an unfinished sentence.
      if (position >= chunks.length - (latest.current.streaming ? 1 : 0)) {
        if (latest.current.streaming) { current.resume = speakNext; return }
        stop(); setEnded(true); return
      }
      let utterance: SpeechSynthesisUtterance
      try { utterance = new SpeechSynthesisUtterance(chunks[position++]) } catch { fail(); return }
      current.utterance = utterance
      utterance.voice = selectedVoice
      utterance.lang = selectedVoice?.lang ?? 'en-US'
      utterance.rate = 1.02
      utterance.pitch = 0.95
      let started = false
      let waits = 0
      const finish = () => {
        utterance.onstart = null; utterance.onend = null; utterance.onerror = null
        current.utterance = null
        speakNext()
      }
      // Slow or network voices can start late or never report their end while audio is still playing,
      // so only fail once the engine itself reports it is silent.
      const timeout = () => {
        if (!live() || current.utterance !== utterance) return
        const speaking = globalThis.speechSynthesis?.speaking
        if (speaking && ++waits <= 20) { current.timer = setTimeout(timeout, 5000); return }
        if (started && speaking === false) { finish(); return }
        fail()
      }
      current.timer = setTimeout(timeout, 5000)
      utterance.onstart = () => {
        if (!live() || current.utterance !== utterance) return
        started = true
        if (position === 1) onSpeechStart?.(messageId)
        // Only an automatic first sentence measures the reply-to-sound wait; manual plays include reading time.
        if (automaticPlay && position === 1) {
          finishInterviewTiming('reply-to-audio', messageId)
          finishInterviewTiming('submit-to-audio', messageId)
        }
        if (current.timer) clearTimeout(current.timer)
        current.timer = setTimeout(timeout, Math.max(15000, utterance.text.length * 150))
      }
      utterance.onend = () => {
        if (!live() || current.utterance !== utterance) return
        finish()
      }
      utterance.onerror = (event?: SpeechSynthesisErrorEvent) => {
        if (event?.error === 'interrupted' || event?.error === 'canceled') return
        if (current.utterance === utterance) fail()
      }
      try { speechSynthesis.speak(utterance) } catch { fail() }
    }
    setError(null)
    // Reserve recording across voice loading and every sentence, including queued starts.
    setPlaying(true); setEnded(false); notify(true)
    selectedVoice = voice()
    if (!selectedVoice && typeof speechSynthesis.getVoices === 'function' && !availableVoices().length) {
      const ready = () => {
        if (!live() || current.utterance) return
        selectedVoice = voice()
        if (!selectedVoice && availableVoices().length === 0) return
        if (current.timer) clearTimeout(current.timer)
        current.removeVoiceListener?.()
        current.removeVoiceListener = undefined
        speakNext()
      }
      speechSynthesis.addEventListener?.('voiceschanged', ready)
      current.removeVoiceListener = () => speechSynthesis.removeEventListener?.('voiceschanged', ready)
      current.timer = setTimeout(() => {
        if (!live() || current.utterance) return
        selectedVoice = voice()
        current.removeVoiceListener?.()
        current.removeVoiceListener = undefined
        speakNext()
      }, 300)
    } else speakNext()
  }, [messageId, notify, onSpeechStart, stop, supported])
  useEffect(() => {
    if (!automatic || attempted.current) return
    const timer = setTimeout(() => {
      attempted.current = true
      onAutomaticAttempt?.(messageId)
      if (allowed.current) play(true)
    }, 0)
    return () => clearTimeout(timer)
  }, [automatic, messageId, onAutomaticAttempt, play])
  if (!supported) return <p className="text-sm text-muted-foreground">Browser speech is unavailable. Read the question and record your answer.</p>
  return <div className="grid gap-2">
    <div className="flex flex-wrap gap-2">
      {!ended && <Button variant="outline" disabled={muted || disabled || !text.trim()} onClick={() => playing ? stop() : play()}>{playing ? 'Stop interviewer audio' : 'Play interviewer audio'}</Button>}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>
}
