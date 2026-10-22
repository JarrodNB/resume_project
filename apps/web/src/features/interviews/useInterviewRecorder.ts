/** Capture one complete recording for explicit answer submission, with optional live recognition.
 * Recording and recognition finish independently; review waits for both. Tracks are released
 * on every exit, including a permission prompt that resolves after the page has gone away.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { startBrowserTranscription, type TranscriptionCallbacks, type TranscriptionCapture, type TranscriptionMode } from './transcriptionCapture'

type Status = 'idle' | 'requesting' | 'recording' | 'finalizing' | 'ready'
type Capture = { recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; bytes: number; discard: boolean; timer?: ReturnType<typeof setTimeout> }
const MAX_BYTES = 10 * 1024 * 1024
const FORMATS = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
const release = (stream: MediaStream) => stream.getTracks().forEach((track) => track.stop())

export function useInterviewRecorder({ mode = 'recorded', startStreaming }: { mode?: TranscriptionMode; startStreaming?: (stream: MediaStream, callbacks: TranscriptionCallbacks) => TranscriptionCapture } = {}) {
  const [status, setStatus] = useState<Status>('idle')
  const [recording, setRecording] = useState<Blob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState('')
  const [candidateTranscript, setCandidateTranscript] = useState<string | null>(null)
  const [effectiveMode, setEffectiveMode] = useState<TranscriptionMode>(mode)
  const [fallbackReason, setFallbackReason] = useState<string | null>(null)
  const transcription = useRef<TranscriptionCapture | null>(null)
  const finalized = useRef<Promise<string | null> | null>(null)
  const generation = useRef(0)
  const busy = useRef(false)
  const capture = useRef<Capture | null>(null)

  const discard = useCallback(() => {
    generation.current += 1
    transcription.current?.cancel(); transcription.current = null; finalized.current = null
    busy.current = false
    const current = capture.current
    capture.current = null
    if (current) {
      current.discard = true
      clearTimeout(current.timer)
      release(current.stream)
      if (current.recorder.state !== 'inactive') current.recorder.stop()
    }
  }, [])
  useEffect(() => discard, [discard])

  const reset = useCallback(() => {
    discard()
    setStatus('idle'); setRecording(null); setError(null)
    setTranscript(''); setCandidateTranscript(null); setFallbackReason(null); setEffectiveMode(mode)
  }, [discard, mode])

  const start = useCallback(async () => {
    if (busy.current) return
    reset()
    busy.current = true
    const request = generation.current
    setStatus('requesting')
    let stream: MediaStream | undefined
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('This browser cannot record microphone audio.')
      }
      const format = FORMATS.find((type) => MediaRecorder.isTypeSupported(type))
      if (!format) throw new Error('This browser has no supported recording format.')
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (generation.current !== request) { release(stream); return }
      const recorder = new MediaRecorder(stream, { mimeType: format })
      const current: Capture = { recorder, stream, chunks: [], bytes: 0, discard: false }
      capture.current = current
      const fail = (message: string) => {
        if (capture.current !== current) return
        discard(); setRecording(null); setError(message); setStatus('idle')
      }
      stream.getTracks().forEach((track) => track.addEventListener('ended', () => {
        fail('The microphone disconnected. Please reconnect it and record again.')
      }, { once: true }))
      recorder.ondataavailable = ({ data }) => {
        if (current.discard || capture.current !== current) return
        current.bytes += data.size
        if (current.bytes >= MAX_BYTES) { fail('Recording reached 10 MiB. Please record a shorter answer.'); return }
        if (data.size > 0) current.chunks.push(data)
      }
      recorder.onerror = () => fail('Recording failed. Please check your microphone and try again.')
      recorder.onstop = async () => {
        clearTimeout(current.timer)
        release(current.stream)
        if (current.discard || capture.current !== current) return
        const finalText = finalized.current ? await finalized.current.catch(() => {
          if (capture.current === current) { setEffectiveMode('recorded'); setFallbackReason('Recognition finalization failed. Your recording is kept. Finish recording, then choose Transcribe recording.') }
          return null
        }) : null
        if (current.discard || capture.current !== current) return
        capture.current = null; busy.current = false; transcription.current = null
        setCandidateTranscript(finalText)
        const blob = new Blob(current.chunks, { type: recorder.mimeType || current.chunks[0]?.type || format })
        if (blob.size === 0) { setError('The recording is empty. Please try again.'); setStatus('idle'); return }
        setRecording(blob); setStatus('ready')
      }
      recorder.start(1000)
      const callbacks: TranscriptionCallbacks = {
        text(text) { if (capture.current === current && !current.discard) setTranscript(text) },
        fallback(reason) { if (capture.current === current && !current.discard) { setEffectiveMode('recorded'); setFallbackReason(reason) } },
      }
      if (mode === 'browser') transcription.current = startBrowserTranscription(callbacks)
      if (mode === 'streaming') {
        if (startStreaming) {
          try { transcription.current = startStreaming(stream, callbacks) }
          catch { callbacks.fallback('Streaming could not start. Your recording is kept. Finish recording, then choose Transcribe recording.') }
        } else callbacks.fallback('Streaming is unavailable. Your recording is kept. Finish recording, then choose Transcribe recording.')
      }
      current.timer = setTimeout(() => fail('Recording reached 2 minutes. Please record a shorter answer.'), 120_000)
      setStatus('recording')
    } catch (cause) {
      if (stream) release(stream)
      if (generation.current !== request) return
      discard()
      setError(cause instanceof Error && /format|browser/.test(cause.message) ? cause.message : 'Could not start the microphone. Check permission and your recording device, then try again.')
      setStatus('idle')
    }
  }, [discard, reset, mode, startStreaming])

  const stop = useCallback(() => {
    const current = capture.current
    if (!current) return
    clearTimeout(current.timer)
    setStatus('finalizing')
    if (!finalized.current) finalized.current = transcription.current?.finish() ?? null
    if (current.recorder.state !== 'inactive') current.recorder.stop()
    release(current.stream)
  }, [])
  return { status, recording, error, transcript, candidateTranscript, effectiveMode, fallbackReason, start, stop, reset }
}
