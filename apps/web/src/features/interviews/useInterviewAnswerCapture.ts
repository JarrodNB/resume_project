/** Keep microphone capture, editable text and recorded transcription in one draft lifetime.
 * Tickets and upload identities never escape this hook. Saved session operations can be
 * recovered for explicit review, but only the current capture may fill the answer automatically.
 * Durable submission and interview progression remain with useInterviewSession.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAnswerDraft } from './useAnswerDraft'
import { useInterviewRecorder } from './useInterviewRecorder'
import type { useInterviewSession } from './useInterviewSession'
import type { TranscriptionMode } from './transcriptionCapture'

type Ticket = ReturnType<ReturnType<typeof useAnswerDraft>['beginCapture']>
type Upload = { kind: 'uploading'; context: string; ticket: Ticket }
type Review =
  | { kind: 'none' }
  | Upload
  | { kind: 'selected'; context: string; id: string; ticket: Ticket | null }
  | { kind: 'dismissed'; recording: Blob | null }
type ReviewLifecycle = { review: Review; upload: Upload | null }
type Session = Pick<ReturnType<typeof useInterviewSession>, 'interview' | 'transcribeRecording' | 'cancelTranscription' | 'answerText'>
type Options = NonNullable<Parameters<typeof useInterviewRecorder>[0]> & {
  session: Session
  abandoned: boolean
  onModeChange: (mode: TranscriptionMode) => void
}

/** Own the unsaved answer. Clearing after an accepted answer, skip, or mode change
 * releases its capture; discarding only the recording retains authored text.
 * Passive unmount fences local results without cancelling durable session work.
 */
export function useInterviewAnswerCapture({ session, abandoned, onModeChange, ...recorderOptions }: Options) {
  const { interview, transcribeRecording, cancelTranscription } = session
  const context = `${interview?.id}:${interview?.revision}:${interview?.status}`
  const terminal = abandoned || interview?.status === 'abandoned' || interview?.status === 'completed' || interview?.status === 'expired'
  const draft = useAnswerDraft(context)
  const recorder = useInterviewRecorder(recorderOptions)
  const recordedTranscript = useRef<string | null>(null)
  const captureTicket = useRef<Ticket | null>(null)
  const [lifecycle, setLifecycle] = useState<ReviewLifecycle>({ review: { kind: 'none' }, upload: null })
  // An invalidated upload still holds the upload slot until its receipt arrives.
  // Its identity also fences local writes even before React renders an edit or cancellation.
  const currentLifecycle = useRef(lifecycle)
  const changeLifecycle = useCallback((next: ReviewLifecycle) => {
    currentLifecycle.current = next
    setLifecycle(next)
  }, [])
  const changeReview = useCallback((review: Review) => {
    changeLifecycle({ ...currentLifecycle.current, review })
  }, [changeLifecycle])
  const review = lifecycle.review
  const selectedReview = review.kind === 'selected' && review.context === context ? review : null
  const operation = selectedReview
    ? interview?.operations.find((item) => item.id === selectedReview.id)
    : interview?.operations.filter((item) => item.kind === 'transcription' && item.expectedRevision === interview.revision && item.status !== 'expired').at(-1)
  const pending = operation?.status === 'pending' || operation?.status === 'running'
  const saving = lifecycle.upload !== null
  const capturing = recorder.status === 'recording' || recorder.status === 'requesting' || recorder.status === 'finalizing'
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const { previewCapture, finishCapture } = draft
  useEffect(() => {
    if ((recorder.status === 'recording' || recorder.status === 'finalizing') && captureTicket.current && recorder.transcript) {
      previewCapture(captureTicket.current, recorder.transcript)
    }
  }, [recorder.status, recorder.transcript, previewCapture])
  useEffect(() => {
    if (recorder.status !== 'ready' || !recorder.candidateTranscript || !captureTicket.current) return
    recordedTranscript.current = [recordedTranscript.current, recorder.candidateTranscript].filter(Boolean).join(' ')
    finishCapture(captureTicket.current, recorder.candidateTranscript)
    captureTicket.current = null
  }, [recorder.status, recorder.candidateTranscript, finishCapture])
  useEffect(() => {
    if (selectedReview?.ticket && operation?.status === 'accepted' && operation.reviewTranscript) {
      recordedTranscript.current = operation.reviewTranscript
      finishCapture(selectedReview.ticket, operation.reviewTranscript)
    }
  }, [selectedReview, operation, finishCapture])
  const previousContext = useRef(context)
  const { status, reset } = recorder
  useEffect(() => {
    // Progress from another tab releases the old microphone and invalidates its upload receipt.
    const changed = previousContext.current !== context
    previousContext.current = context
    if (terminal || changed) {
      captureTicket.current = null
      recordedTranscript.current = null
      changeReview({ kind: 'none' })
      if (status !== 'idle') reset()
    }
  }, [context, terminal, status, reset, changeReview])

  function cancelReview() {
    captureTicket.current = null
    const current = currentLifecycle.current.review
    const recording = operation ? recorder.recording : current.kind === 'dismissed' ? current.recording : null
    changeReview({ kind: 'dismissed', recording })
    if (operation) void cancelTranscription(operation.id)
  }
  function start() {
    cancelReview()
    changeReview({ kind: 'none' })
    captureTicket.current = draft.beginCapture()
    recordedTranscript.current = null
    void recorder.start()
  }
  function resume() {
    cancelReview()
    changeReview({ kind: 'none' })
    captureTicket.current = draft.beginCapture()
    if (recorder.effectiveMode === 'recorded' && recordedTranscript.current) {
      captureTicket.current = draft.beginCapture(recordedTranscript.current)
    }
    recorder.resume()
  }
  function edit(text: string) {
    if (capturing) draft.editCapture(text)
    else { cancelReview(); draft.setText(text) }
  }
  function discardRecording() { cancelReview(); recorder.reset() }
  function clearDraft() {
    recordedTranscript.current = null
    draft.setText('')
    recorder.reset()
    changeReview({ kind: 'none' })
  }
  function clear() { cancelReview(); clearDraft() }
  function changeMode(mode: TranscriptionMode) {
    clear()
    onModeChange(mode)
  }
  async function submit(text: string) {
    cancelReview()
    const saved = await session.answerText(text)
    if (saved) clearDraft()
    return saved
  }
  async function transcribe() {
    if (!recorder.recording || currentLifecycle.current.upload || terminal) return
    const request: Upload = { kind: 'uploading', context, ticket: captureTicket.current ?? draft.beginCapture() }
    captureTicket.current = null
    changeLifecycle({ review: request, upload: request })
    try {
      const id = await transcribeRecording(recorder.recording)
      if (!id || !mounted.current) return
      if (currentLifecycle.current.review === request) changeReview({ kind: 'selected', context: request.context, id, ticket: request.ticket })
      else void cancelTranscription(id)
    } finally {
      if (mounted.current && currentLifecycle.current.upload === request) {
        const current = currentLifecycle.current
        changeLifecycle({ review: current.review === request ? { kind: 'none' } : current.review, upload: null })
      }
    }
  }
  function reviewSavedTranscript() {
    if (operation?.status !== 'accepted' || !operation.reviewTranscript) return
    const ticket = draft.beginCapture()
    finishCapture(ticket, operation.reviewTranscript)
    changeReview({ kind: 'selected', context, id: operation.id, ticket: null })
  }
  const reviewed = selectedReview !== null || (review.kind === 'dismissed' && review.recording === recorder.recording)
  return {
    text: draft.text, edit, start, resume, stop: recorder.stop, discardRecording, clear, changeMode, submit, cancelReview, transcribe, reviewSavedTranscript,
    terminal, capturing,
    recorder: {
      status: recorder.status, recording: recorder.recording, error: recorder.error,
      transcript: recorder.transcript, candidateTranscript: recorder.candidateTranscript,
      effectiveMode: recorder.effectiveMode, fallbackReason: recorder.fallbackReason,
    },
    review: {
      operation, pending, saving, reviewed,
      canTranscribe: !recorder.candidateTranscript && !selectedReview && !(review.kind === 'dismissed' && review.recording === recorder.recording),
      canRestore: !selectedReview && operation?.status === 'accepted' && Boolean(operation.reviewTranscript),
    },
  }
}
