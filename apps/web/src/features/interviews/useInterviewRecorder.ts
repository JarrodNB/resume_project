/** Capture one answer without submitting it. Tracks are released on every exit,
 * including a permission prompt that resolves after the page has gone away.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

type Status = 'idle' | 'requesting' | 'recording' | 'ready'
type Capture = { recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; bytes: number; discard: boolean; timer?: ReturnType<typeof setTimeout> }
const MAX_BYTES = 10 * 1024 * 1024
const FORMATS = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
const release = (stream: MediaStream) => stream.getTracks().forEach((track) => track.stop())

export function useInterviewRecorder() {
  const [status, setStatus] = useState<Status>('idle')
  const [recording, setRecording] = useState<Blob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const busy = useRef(false)
  const capture = useRef<Capture | null>(null)

  const discard = useCallback(() => {
    generation.current += 1
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
  }, [discard])

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
      recorder.onstop = () => {
        clearTimeout(current.timer)
        release(current.stream)
        if (current.discard || capture.current !== current) return
        capture.current = null; busy.current = false
        const blob = new Blob(current.chunks, { type: recorder.mimeType || current.chunks[0]?.type || format })
        if (blob.size === 0) { setError('The recording is empty. Please try again.'); setStatus('idle'); return }
        setRecording(blob); setStatus('ready')
      }
      recorder.start(1000)
      current.timer = setTimeout(() => fail('Recording reached 2 minutes. Please record a shorter answer.'), 120_000)
      setStatus('recording')
    } catch (cause) {
      if (stream) release(stream)
      if (generation.current !== request) return
      discard()
      setError(cause instanceof Error && /format|browser/.test(cause.message) ? cause.message : 'Could not start the microphone. Check permission and your recording device, then try again.')
      setStatus('idle')
    }
  }, [discard, reset])

  const stop = useCallback(() => {
    const current = capture.current
    if (!current) return
    clearTimeout(current.timer)
    if (current.recorder.state !== 'inactive') current.recorder.stop()
    release(current.stream)
  }, [])
  return { status, recording, error, start, stop, reset }
}
