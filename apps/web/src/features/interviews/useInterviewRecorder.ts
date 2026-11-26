/** Capture one complete recording for explicit answer submission, with optional live recognition.
 * Stopping pauses the same audio container; continuing appends audio without joining files.
 * Live recognition failures pause capture and keep its audio and visible words for recovery.
 * Recording and recognition finish independently; review waits for both. Tracks are released
 * on every exit, including a permission prompt that resolves after the page has gone away.
 * Speech processing and mono capture are preferences; the browser negotiates device support.
 * Reaching the 2-minute or 10 MiB limit normally discards the recording. Hands-free answers ask to
 * pause there instead, keeping the audio and words for review; that capture cannot be continued.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { startBrowserTranscription, type TranscriptionCallbacks, type TranscriptionCapture, type TranscriptionMode } from './transcriptionCapture'

type Status = 'idle' | 'requesting' | 'recording' | 'finalizing' | 'ready'
type Capture = { recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; bytes: number; discard: boolean; remaining: number; started: number; checkpoint?: () => void; listen?: () => void; timer?: ReturnType<typeof setTimeout>; atTimeLimit?: () => void; limitReached?: boolean }
const MAX_BYTES = 10 * 1024 * 1024
const FORMATS = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
const release = (stream: MediaStream) => stream.getTracks().forEach((track) => track.stop())
const TIME_LIMIT_MESSAGE = 'Answers can be up to 2 minutes. That recording was stopped and not saved, so please record a shorter one.'

interface RecorderOptions {
  mode?: TranscriptionMode
  startStreaming?: (stream: MediaStream, callbacks: TranscriptionCallbacks) => TranscriptionCapture
  /** Pause instead of discarding when the recording reaches its time or size limit (hands-free answers). */
  pauseAtLimit?: boolean
}

export function useInterviewRecorder({ mode = 'recorded', startStreaming, pauseAtLimit = false }: RecorderOptions = {}) {
  const [status, setStatus] = useState<Status>('idle')
  const [recording, setRecording] = useState<Blob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState('')
  const [candidateTranscript, setCandidateTranscript] = useState<string | null>(null)
  const [effectiveMode, setEffectiveMode] = useState<TranscriptionMode>(mode)
  const [fallbackReason, setFallbackReason] = useState<string | null>(null)
  // Stays true after a live failure even if a later segment succeeds, since earlier words may be missing.
  const [liveFailed, setLiveFailed] = useState(false)
  const [limitReached, setLimitReached] = useState(false)
  const pauseAtLimitRef = useRef(pauseAtLimit)
  useEffect(() => { pauseAtLimitRef.current = pauseAtLimit }, [pauseAtLimit])
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
    setTranscript(''); setCandidateTranscript(null); setFallbackReason(null); setEffectiveMode(mode); setLiveFailed(false); setLimitReached(false)
  }, [discard, mode])

  const stop = useCallback(() => {
    const current = capture.current
    if (!current || current.recorder.state !== 'recording') return
    clearTimeout(current.timer)
    current.remaining -= Date.now() - current.started
    setStatus('finalizing')
    if (!finalized.current) finalized.current = transcription.current?.finish() ?? null
    current.stream.getAudioTracks().forEach((track) => { track.enabled = false })
    current.recorder.pause()
  }, [])

  const start = useCallback(async () => {
    if (busy.current && capture.current?.recorder.state !== 'paused') return
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
      stream = await navigator.mediaDevices.getUserMedia({ audio: {
        channelCount: { ideal: 1 },
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true },
      } })
      if (generation.current !== request) { release(stream); return }
      const recorder = new MediaRecorder(stream, { mimeType: format, audioBitsPerSecond: 128_000 })
      const current: Capture = { recorder, stream, chunks: [], bytes: 0, discard: false, remaining: 120_000, started: Date.now() }
      capture.current = current
      const fail = (message: string) => {
        if (capture.current !== current) return
        discard(); setRecording(null); setError(message); setStatus('idle')
      }
      const pauseAtLimitInstead = () => {
        if (!pauseAtLimitRef.current) return false
        current.limitReached = true
        setLimitReached(true)
        stop()
        return true
      }
      current.atTimeLimit = () => { if (!pauseAtLimitInstead()) fail(TIME_LIMIT_MESSAGE) }
      stream.getTracks().forEach((track) => track.addEventListener('ended', () => {
        fail('The microphone disconnected. Please reconnect it and record again.')
      }, { once: true }))
      recorder.ondataavailable = ({ data }) => {
        if (current.discard || capture.current !== current) return
        current.bytes += data.size
        if (current.bytes >= MAX_BYTES) {
          // Leave the piece that went over out, so the kept recording stays under the limit.
          current.bytes -= data.size
          if (!pauseAtLimitInstead()) { fail('That recording went over 10 MiB and was not saved. Please record a shorter answer.'); return }
        } else if (data.size > 0) current.chunks.push(data)
        current.checkpoint?.(); current.checkpoint = undefined
      }
      recorder.onerror = () => fail('Recording failed. Please check your microphone and try again.')
      const review = async () => {
        const finalText = finalized.current ? await finalized.current.catch(() => {
          if (capture.current === current) { setEffectiveMode('recorded'); setFallbackReason('Live transcription couldn\'t finish.'); setLiveFailed(true) }
          return null
        }) : null
        if (current.discard || capture.current !== current) return
        transcription.current = null
        setCandidateTranscript(finalText)
        const blob = new Blob(current.chunks, { type: recorder.mimeType || current.chunks[0]?.type || format })
        if (blob.size === 0) { discard(); setError('The recording is empty. Please try again.'); setStatus('idle'); return }
        setRecording(blob); setStatus('ready')
      }
      recorder.onstop = () => { release(current.stream) }
      recorder.start(1000)
      let listening = 0
      current.listen = () => {
        const attempt = ++listening
        let failed = false
        finalized.current = null
        setEffectiveMode(mode); setFallbackReason(null)
        setTranscript(''); setCandidateTranscript(null)
        const callbacks: TranscriptionCallbacks = {
          text(text) { if (capture.current === current && !current.discard && attempt === listening && !failed) setTranscript(text) },
          fallback(reason) {
            if (capture.current !== current || current.discard || attempt !== listening || failed) return
            failed = true
            setEffectiveMode('recorded'); setFallbackReason(reason); setLiveFailed(true)
            // Startup can fail synchronously, before pause listeners are ready.
            // Fence queued failures so they cannot pause a resumed or replacement capture.
            queueMicrotask(() => { if (capture.current === current && !current.discard && attempt === listening) stop() })
          },
        }
        if (mode === 'browser') transcription.current = startBrowserTranscription(callbacks)
        if (mode === 'streaming') {
          if (startStreaming) {
            try { transcription.current = startStreaming(current.stream, callbacks) }
            catch { callbacks.fallback('We couldn\'t start live transcription.') }
          } else callbacks.fallback('Live transcription isn\'t available right now.')
        }
      }
      current.listen()
      // requestData flushes a preview while keeping the encoder available for continuation.
      current.recorder.addEventListener('pause', () => {
        if (capture.current !== current || current.discard) return
        current.checkpoint = () => { void review() }
        current.recorder.requestData()
      })
      current.timer = setTimeout(() => current.atTimeLimit?.(), 120_000)
      setStatus('recording')
    } catch (cause) {
      if (stream) release(stream)
      if (generation.current !== request) return
      discard()
      setError(cause instanceof Error && /format|browser/.test(cause.message) ? cause.message : 'Could not start the microphone. Check permission and your recording device, then try again.')
      setStatus('idle')
    }
  }, [discard, reset, mode, startStreaming, stop])

  const resume = useCallback(() => {
    const current = capture.current
    if (!current || current.recorder.state !== 'paused' || current.limitReached) return
    setRecording(null)
    current.stream.getAudioTracks().forEach((track) => { track.enabled = true })
    current.listen?.()
    current.recorder.resume()
    current.started = Date.now()
    current.timer = setTimeout(() => current.atTimeLimit?.(), Math.max(0, current.remaining))
    setStatus('recording')
  }, [])
  /** The open microphone stream, so hands-free mode can listen for silence without a second permission prompt. */
  const microphoneStream = useCallback(() => capture.current?.stream ?? null, [])
  return { status, recording, error, transcript, candidateTranscript, effectiveMode, fallbackReason, liveFailed, limitReached, start, stop, resume, reset, microphoneStream }
}
