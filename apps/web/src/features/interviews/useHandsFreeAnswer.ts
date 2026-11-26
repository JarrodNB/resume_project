/** Hands-free answers: end the answer when the candidate stops talking, then offer an auto-send countdown.
 * Listening for silence starts only after live transcription has recognised a word in this capture,
 * so a slow start never ends the answer. Silence pauses capture through the normal pause path; once
 * the final transcript arrives, a countdown is offered only if it has words and live transcription
 * finished. The countdown itself and the send live in the answer editor.
 */
import { useEffect, useRef, useState } from 'react'
import { openMicrophoneLevel, watchForEndOfSpeech } from './endOfSpeech'
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
}

type Phase = 'listening' | 'finishing' | 'countdown'

export function useHandsFreeAnswer({ enabled, silenceSeconds, recorder, stop }: Options) {
  const [phase, setPhase] = useState<Phase>('listening')
  const { status, effectiveMode, microphoneStream } = recorder
  // Settle the phase from the recorder during render, so a stale countdown never shows.
  if (phase === 'finishing' && status !== 'recording' && status !== 'finalizing') {
    const finalWords = status === 'ready' && effectiveMode !== 'recorded' && Boolean(recorder.candidateTranscript?.trim())
    setPhase(finalWords ? 'countdown' : 'listening')
  }
  if (phase === 'countdown' && status !== 'ready') setPhase('listening')

  const stopRef = useRef(stop)
  useEffect(() => { stopRef.current = stop }, [stop])
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

  return {
    /** The final transcript is ready to send automatically after a countdown. */
    countingDown: enabled && phase === 'countdown',
    /** Keep editing, Send now, a typed edit, or the countdown finishing all end the offer. */
    endCountdown: () => setPhase('listening'),
  }
}
