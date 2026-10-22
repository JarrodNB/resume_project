/** Load owner-bound saved speech and manage its playback lifetime.
 * One control pauses/resumes or replays a completed turn. Autoplay is attempted once
 * for a new turn; playback failure never regenerates speech.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation } from '@apollo/client/react'
import { Button } from '@/components/ui/button'
import { INTERVIEW_PLAYBACK } from './interviewOperations'

type Props = {
  interviewId: string
  messageId: string
  automatic?: boolean
  muted?: boolean
  disabled?: boolean
  otherSpeechPlaying?: boolean
  onAutomaticAttempt?: (messageId: string) => void
  onPlayingChange?: (playing: boolean, messageId: string) => void
}

export function InterviewAudio(props: Props) {
  return <SavedInterviewAudio key={`${props.interviewId}:${props.messageId}`} {...props} />
}

function SavedInterviewAudio({ interviewId, messageId, automatic = false, muted = false, disabled = false, otherSpeechPlaying = false, onPlayingChange, onAutomaticAttempt }: Props) {
  const [request] = useMutation(INTERVIEW_PLAYBACK)
  const audio = useRef<HTMLAudioElement>(null)
  const generation = useRef(0)
  const permitted = useRef(!disabled && !muted)
  const attempted = useRef(false)
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [ended, setEnded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const notify = useCallback((value: boolean) => onPlayingChange?.(value, messageId), [onPlayingChange, messageId])

  const stop = useCallback(() => {
    generation.current += 1
    audio.current?.pause()
    setPlaying(false)
    notify(false)
  }, [notify])
  // Synchronize this player's controls after another media element takes the turn.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    if (otherSpeechPlaying) { generation.current += 1; stop(); setLoading(false) }
  }, [otherSpeechPlaying, stop])
  useEffect(() => {
    permitted.current = !disabled && !muted
    if (!permitted.current) {
      generation.current += 1
      stop()
      setLoading(false)
    }
  }, [disabled, muted, stop])
  useEffect(() => {
    const element = audio.current
    return () => {
      generation.current += 1
      permitted.current = false
      element?.pause()
      element?.removeAttribute('src')
      notify(false)
    }
  }, [notify])

  const play = useCallback(async (replay = false) => {
    if (!permitted.current) return
    const identity = ++generation.current
    setError(null)
    try {
      let source = url
      if (!source) {
        setLoading(true)
        const payload = (await request({ variables: { input: { interviewId, messageId } } })).data?.interviewPlayback
        if (identity !== generation.current || !permitted.current) return
        if (!payload?.playback || payload.errors.length) throw new Error(payload?.errors.join(' ') || 'This audio is unavailable or expired.')
        source = payload.playback.playbackUrl
        setUrl(source)
      }
      const element = audio.current
      if (!element || identity !== generation.current || !permitted.current) return
      if (element.getAttribute('src') !== source) element.src = source
      if (replay) element.currentTime = 0
      try { await element.play() }
      catch {
        if (identity === generation.current && permitted.current) setError('Audio did not start. Press Play interviewer audio to try again.')
        return
      }
      if (identity !== generation.current || !permitted.current) {
        // A superseded play may share this element with a newer successful play.
        if (!permitted.current) element.pause()
        return
      }
      setPlaying(true); setEnded(false); notify(true)
    } catch (cause) {
      if (identity === generation.current) {
        setUrl(null)
        setError(cause instanceof Error ? cause.message : 'Could not load saved audio. Try again.')
      }
    } finally { if (identity === generation.current) setLoading(false) }
  }, [url, request, interviewId, messageId, notify])

  useEffect(() => {
    if (!automatic || attempted.current) return
    // Deferring dispatch lets StrictMode cancel its rehearsal without obtaining two grants.
    const timer = setTimeout(() => {
      attempted.current = true
      onAutomaticAttempt?.(messageId)
      if (permitted.current) void play()
    }, 0)
    return () => clearTimeout(timer)
  }, [automatic, play, onAutomaticAttempt, messageId])

  function audioFailed() {
    generation.current += 1
    stop(); setEnded(false); setLoading(false); setUrl(null)
    setError('The playback link may have expired. Play interviewer audio to request a fresh link. Audio itself expires one hour after completion.')
  }
  return <div className="grid gap-2">
    <audio ref={audio} preload="none" src={url ?? undefined} muted={muted} aria-label="Saved interviewer speech" onPlay={() => { if (permitted.current) { setLoading(false); setPlaying(true); notify(true) } else audio.current?.pause() }} onEnded={() => { stop(); setEnded(true) }} onPause={() => { setPlaying(false); notify(false) }} onError={audioFailed} />
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={disabled || muted || loading} aria-busy={loading} onClick={() => playing ? stop() : void play(ended)}>{loading ? 'Loading audio…' : playing ? 'Pause interviewer audio' : ended ? 'Replay interviewer audio' : 'Play interviewer audio'}</Button>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>
}
