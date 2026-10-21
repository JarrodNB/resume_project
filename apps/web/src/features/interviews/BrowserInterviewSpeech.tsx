/** Speak saved interviewer text with the browser's voice engine.
 * Playback is disposable: stopping, recording, navigation or errors release the turn.
 * Browser voices may use device or network services; this never requests provider audio.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

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
// The browser has one speech queue shared by all conversation players.
let activeUtterance: SpeechSynthesisUtterance | null = null

export function BrowserInterviewSpeech(props: Props) {
  return <BrowserSpeech key={props.messageId} {...props} />
}
function BrowserSpeech({ messageId, text, automatic = false, muted = false, disabled = false, otherSpeechPlaying = false, onAutomaticAttempt, onPlayingChange }: Props) {
  const supported = Boolean(globalThis.speechSynthesis && globalThis.SpeechSynthesisUtterance)
  const utterance = useRef<SpeechSynthesisUtterance | null>(null)
  const allowed = useRef(!muted && !disabled)
  const attempted = useRef(false)
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [playing, setPlaying] = useState(false)
  const [played, setPlayed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const notify = useCallback((value: boolean) => onPlayingChange?.(value, messageId), [onPlayingChange, messageId])
  const stop = useCallback(() => {
    if (deadline.current) clearTimeout(deadline.current)
    deadline.current = null
    const current = utterance.current
    utterance.current = null
    if (current) {
      current.onstart = null; current.onend = null; current.onerror = null
      if (activeUtterance === current) { activeUtterance = null; globalThis.speechSynthesis?.cancel() }
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
    const current = new SpeechSynthesisUtterance(text)
    if (activeUtterance) speechSynthesis.cancel()
    activeUtterance = current
    utterance.current = current
    const finish = (failed: boolean) => {
      if (utterance.current !== current) return
      if (deadline.current) clearTimeout(deadline.current)
      deadline.current = null
      utterance.current = null
      if (activeUtterance === current) activeUtterance = null
      setPlaying(false); notify(false)
      if (failed) setError('Browser speech did not finish. Press Play interviewer audio to try again, or read the question and record your answer.')
    }
    const timeout = () => {
      if (utterance.current !== current) return
      stop()
      setError('Browser speech did not start or finish. Press Play interviewer audio to try again, or read the question and record your answer.')
    }
    // Some engines emit no error when autoplay is denied. Never hold recording forever.
    deadline.current = setTimeout(timeout, 5000)
    current.onstart = () => {
      if (utterance.current !== current) return
      if (deadline.current) clearTimeout(deadline.current)
      deadline.current = setTimeout(timeout, Math.min(180000, Math.max(30000, text.length * 120)))
    }
    current.onend = () => finish(false)
    current.onerror = () => finish(true)
    setError(null)
    // Reserve the turn immediately, including the browser's queued-start interval.
    setPlaying(true); setPlayed(true); notify(true)
    try { speechSynthesis.speak(current) }
    catch { finish(true) }
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
      <Button variant="outline" disabled={muted || disabled || !text.trim()} onClick={() => playing ? stop() : play()}>{playing ? 'Stop interviewer audio' : 'Play interviewer audio'}</Button>
      {played && <Button variant="ghost" disabled={muted || disabled || !text.trim()} onClick={play}>Replay question</Button>}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>
}
