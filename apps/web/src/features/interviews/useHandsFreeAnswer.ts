/** Hands-free answers: end the answer when the candidate stops talking, then offer an auto-send countdown.
 * Listening for silence starts only after live transcription has recognised a word in this capture,
 * so a slow start never ends the answer. Silence pauses capture through the normal pause path; once
 * the final transcript arrives, a countdown is offered only if it has words and live transcription
 * finished. A blank transcript means nothing was said, so recording simply continues. Speaking
 * during the countdown cancels it and continues recording through the normal continue path, so new
 * words are added to the same answer. The countdown itself and the send live in the answer editor.
 */
import { useEffect, useRef, useState } from 'react'
import { openMicrophoneLevel, watchForEndOfSpeech, watchForSpeech } from './endOfSpeech'
import type { TranscriptionMode } from './transcriptionCapture'

interface Options {
  /** Hands-free is switched on and the chosen transcription mode is live. */
  enabled: boolean
  silenceSeconds: number
  recorder: {
    status: string
    transcript: string
    candidateTranscript: string | null
    effectiveMode: TranscriptionMode
    microphoneStream: () => MediaStream | null
  }
  /** The normal "Pause recording" action. */
  stop: () => void
  /** The normal "Continue recording" action, which adds new words to the same answer. */
  resume: () => void
}

type Phase = 'listening' | 'finishing' | 'countdown' | 'resuming'

export function useHandsFreeAnswer({ enabled, silenceSeconds, recorder, stop, resume }: Options) {
  const [phase, setPhase] = useState<Phase>('listening')
  const { status, effectiveMode, microphoneStream } = recorder
  // Settle the phase from the recorder during render, so a stale countdown never shows.
  if (phase === 'finishing' && status !== 'recording' && status !== 'finalizing') {
    const liveReview = status === 'ready' && effectiveMode !== 'recorded'
    // Silence that produced no words was not an answer, so keep listening.
    setPhase(!liveReview ? 'listening' : recorder.candidateTranscript?.trim() ? 'countdown' : 'resuming')
  }
  if ((phase === 'countdown' || phase === 'resuming') && status !== 'ready') setPhase('listening')

  const stopRef = useRef(stop)
  const resumeRef = useRef(resume)
  useEffect(() => { stopRef.current = stop; resumeRef.current = resume }, [stop, resume])
  // Continue the same capture; the phase returns to listening once recording restarts.
  useEffect(() => { if (phase === 'resuming') resumeRef.current() }, [phase])
  const heardWords = /\S/u.test(recorder.transcript)
  const watching = enabled && phase === 'listening' && status === 'recording' && effectiveMode !== 'recorded' && heardWords
  useEffect(() => {
    if (!watching) return
    const stream = microphoneStream()
    const microphone = stream && openMicrophoneLevel(stream)
    if (!microphone) return
    const stopWatching = watchForEndOfSpeech({
      readLevel: microphone.readLevel,
      silenceMs: silenceSeconds * 1000,
      onEndOfSpeech() { setPhase('finishing'); stopRef.current() },
    })
    return () => { stopWatching(); microphone.close() }
  }, [watching, silenceSeconds, microphoneStream])

  // Speaking during the countdown cancels it and continues recording into the same answer.
  const countingDown = enabled && phase === 'countdown'
  useEffect(() => {
    if (!countingDown) return
    const stream = microphoneStream()
    const microphone = stream && openMicrophoneLevel(stream)
    if (!microphone) return
    const stopWatching = watchForSpeech({ readLevel: microphone.readLevel, onSpeech() { setPhase('resuming') } })
    return () => { stopWatching(); microphone.close() }
  }, [countingDown, microphoneStream])

  return {
    /** The final transcript is ready to send automatically after a countdown. */
    countingDown,
    /** Keep editing, Send now, a typed edit, or the countdown finishing all end the offer. */
    endCountdown: () => setPhase('listening'),
  }
}
