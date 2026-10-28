/** Speak saved interviewer text with the browser's voice engine.
 * One control plays or stops the turn, then disappears once it finishes; recording, navigation and errors
 * release its disposable playback.
 * Browser voices may use device or network services; this never requests provider audio.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { interviewSpeechChunks, selectInterviewVoice } from './browserSpeechDelivery'

type Props = {
  messageId: string
  text: string
  automatic?: boolean
  muted?: boolean
  disabled?: boolean
  otherSpeechPlaying?: boolean
  onAutomaticAttempt?: (id: string) => void
  onPlayingChange?: (playing: boolean, id: string) => void
}
type Playback = {
  utterance: SpeechSynthesisUtterance | null
  timer: ReturnType<typeof setTimeout> | null
  removeVoiceListener?: () => void
  stop: () => void
}
// The browser has one queue, including requests waiting for voices to load.
let activePlayback: Playback | null = null

export function BrowserInterviewSpeech(props: Props) {
  return <BrowserSpeech key={props.messageId} {...props} />
}
function BrowserSpeech({ messageId, text, automatic = false, muted = false, disabled = false, otherSpeechPlaying = false, onAutomaticAttempt, onPlayingChange }: Props) {
  const supported = Boolean(globalThis.speechSynthesis && globalThis.SpeechSynthesisUtterance)
  const playback = useRef<Playback | null>(null)
  const allowed = useRef(!muted && !disabled)
  const attempted = useRef(false)
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
  const play = useCallback(() => {
    if (!allowed.current || !supported || !text.trim()) return
    stop()
    activePlayback?.stop()
    const current: Playback = { utterance: null, timer: null, stop }
    playback.current = current
    activePlayback = current
    const chunks = interviewSpeechChunks(text)
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
      if (position === chunks.length) { stop(); setEnded(true); return }
      let utterance: SpeechSynthesisUtterance
      try { utterance = new SpeechSynthesisUtterance(chunks[position++]) } catch { fail(); return }
      current.utterance = utterance
      utterance.voice = selectedVoice
      utterance.lang = selectedVoice?.lang ?? 'en-US'
      utterance.rate = 1.02
      utterance.pitch = 0.95
      const timeout = () => { if (current.utterance === utterance) fail() }
      current.timer = setTimeout(timeout, 5000)
      utterance.onstart = () => {
        if (!live() || current.utterance !== utterance) return
        if (current.timer) clearTimeout(current.timer)
        current.timer = setTimeout(timeout, Math.max(15000, utterance.text.length * 150))
      }
      utterance.onend = () => {
        if (!live() || current.utterance !== utterance) return
        utterance.onstart = null; utterance.onend = null; utterance.onerror = null
        current.utterance = null
        speakNext()
      }
      utterance.onerror = () => { if (current.utterance === utterance) fail() }
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
  }, [notify, stop, supported, text])
  useEffect(() => {
    if (!automatic || attempted.current) return
    const timer = setTimeout(() => {
      attempted.current = true
      onAutomaticAttempt?.(messageId)
      if (allowed.current) play()
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
