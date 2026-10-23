/** Keep the current interview turn in focus, with the complete saved dialogue nearby.
 * Saved text permits answering even when speech fails; actual playback and capture never overlap.
 * Saved server state controls progression; recording, review and submission remain explicit.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router'
import { CompletedInterviewReview } from './CompletedInterviewReview'
import { InterviewSetup } from './InterviewSetup'
import { InterviewMicrophoneSettings } from './InterviewMicrophoneSettings'
import { interviewerOptions } from './interviewSetupOptions'
import { PageHeading } from '@/components/PageHeading'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Mic, Square, AudioLines, LoaderCircle, Settings, Volume2, VolumeX } from 'lucide-react'
import './interviewRoom.css'
import { useAuth } from '@/features/auth/useAuth'
import { InterviewClarification } from './InterviewClarification'
import { SkipInterviewQuestionButton } from './SkipInterviewQuestionButton'
import { currentInterviewPrompt } from './currentInterviewPrompt'
import { interviewsEnabled } from './interviewsEnabled'
import { InterviewPreparation } from './InterviewPreparation'
import { AbandonInterviewButton } from './AbandonInterviewButton'
import { RecentInterviews } from './RecentInterviews'
import { AnswerEditor } from './AnswerEditor'
import { useAnswerDraft } from './useAnswerDraft'
import { RecordingReview } from './RecordingReview'
import { RecordingUnsavedChanges } from './RecordingUnsavedChanges'
import { BrowserInterviewSpeech } from './BrowserInterviewSpeech'
import { InterviewAudio } from './InterviewAudio'
import { useAutomaticMicrophone } from './useAutomaticMicrophone'
import { useInterviewMicSettings } from './useInterviewMicSettings'
import { useNewInterviewSpeech } from './useNewInterviewSpeech'
import type { TranscriptionMode } from './transcriptionCapture'
import { useTranscriptionPreference } from './useTranscriptionPreference'
import { useInterviewRecorder } from './useInterviewRecorder'
import { useInterviewStreaming } from './useInterviewStreaming'
import { useInterviewSession } from './useInterviewSession'

const TRANSCRIPTION_HELP = {
  browser: 'Browser recognition fills your answer while you speak using your browser’s speech service.',
  streaming: 'Streaming transcription fills your answer while you speak using OpenAI. Try it if browser recognition is unreliable.',
  recorded: 'Recorded audio transcription records first. After you finish, choose Transcribe recording to fill your answer for review.',
}

export function InterviewPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const { state: navigationState } = useLocation()
  return <div className="interview-page mx-auto grid w-full max-w-6xl gap-6">
    <PageHeading title="Interview" description="Practice a complete interview for a fictional role drawn from your career library." />
    {!interviewsEnabled() ? <p>Interviews are unavailable in this environment.</p> : id ? <OwnedInterview key={`${user?.id}:${id}`} id={id} /> : <>
      {navigationState?.interviewEnded === 'abandoned' && <p role="status" className="text-sm">Interview ended. You can prepare another whenever you’re ready.</p>}
      <InterviewSetup key={JSON.stringify(navigationState?.practiceSetup ?? null)} initialSetup={navigationState?.practiceSetup} notice={<ProviderNotice />} /><RecentInterviews /><InterviewPrivacy />
    </>}
  </div>
}
function InterviewPrivacy() {
  return <details className="border-t pt-4 text-sm text-muted-foreground">
      <summary className="cursor-pointer py-2 font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring">Interview details and privacy</summary>
      <div className="grid gap-3 pt-3">
        <p className="max-w-prose leading-relaxed">Record up to 2 minutes / 10 MiB. Source audio is deleted after success or permanent failure; abandoned uploads expire after 1 hour. Saved speech expires 1 hour after completion; saved text lasts 7 days.</p>
        <ProviderNotice />
      </div>
    </details>
}
function OwnedInterview({ id }: { id: string }) {
  const { user } = useAuth()
  const state = useInterviewSession(id, user?.id ?? '')
  const [transcriptionMode, setTranscriptionMode] = useTranscriptionPreference(user?.id ?? '')
  const startStreaming = useInterviewStreaming(state.interview)
  const recorder = useInterviewRecorder({ mode: transcriptionMode, startStreaming })
  const draftContext = `${id}:${state.interview?.revision}:${state.interview?.status}`
  const previousContext = useRef(draftContext)
  const draft = useAnswerDraft(draftContext)
  const draftText = draft.text
  const captureTicket = useRef<ReturnType<typeof draft.beginCapture> | null>(null)
  const { previewCapture, finishCapture } = draft
  useEffect(() => {
    if ((recorder.status !== 'recording' && recorder.status !== 'finalizing') || !captureTicket.current || !recorder.transcript) return
    previewCapture(captureTicket.current, recorder.transcript)
  }, [recorder.status, recorder.transcript, previewCapture])
  useEffect(() => {
    if (recorder.status !== 'ready' || !recorder.candidateTranscript || !captureTicket.current) return
    finishCapture(captureTicket.current, recorder.candidateTranscript)
    captureTicket.current = null
  }, [recorder.status, recorder.candidateTranscript, finishCapture])
  function startCapture() {
    cancelReview()
    setReviewedRecording(null)
    captureTicket.current = draft.beginCapture()
    void recorder.start()
  }
  const [reviewedRecording, setReviewedRecording] = useState<Blob | null>(null)
  const reviewGeneration = useRef(0)
  const [recordedReview, setRecordedReview] = useState<{ id: string; context: string; ticket: ReturnType<typeof draft.beginCapture> | null } | null>(null)
  const reviewOperation = recordedReview?.context === draftContext
    ? state.interview?.operations.find((item) => item.id === recordedReview.id)
    : state.interview?.operations.filter((item) => item.kind === 'transcription' && item.expectedRevision === state.interview?.revision && item.status !== 'expired').at(-1)
  const mountedReview = useRef(false)
  useEffect(() => {
    mountedReview.current = true
    return () => {
      // React replays cleanup in StrictMode; passive disposal only fences local writes.
      mountedReview.current = false
    }
  }, [])
  const reviewPending = reviewOperation?.status === 'pending' || reviewOperation?.status === 'running'
  useEffect(() => {
    if (!recordedReview?.ticket || recordedReview.context !== draftContext || reviewOperation?.status !== 'accepted' || !reviewOperation.reviewTranscript) return
    finishCapture(recordedReview.ticket, reviewOperation.reviewTranscript)
  }, [recordedReview, reviewOperation, draftContext, finishCapture])
  function cancelReview() {
    reviewGeneration.current++
    captureTicket.current = null
    if (reviewOperation) {
      setReviewedRecording(recorder.recording)
      void state.cancelTranscription(reviewOperation.id)
    }
    setRecordedReview(null)
  }
  function discardRecording() { cancelReview(); recorder.reset() }
  const submitting = useRef(false)
  const [savingRecording, setSavingRecording] = useState(false)
  const [muted, setMuted] = useState(false)
  const [abandoned, setAbandoned] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pendingTranscriptionMode, setPendingTranscriptionMode] = useState<TranscriptionMode | null>(null)
  const [skipOpen, setSkipOpen] = useState(false)
  const microphone = useInterviewMicSettings(user?.id ?? '')
  const [pageVisible, setPageVisible] = useState(!document.hidden)
  useEffect(() => {
    const changed = () => setPageVisible(!document.hidden)
    document.addEventListener('visibilitychange', changed)
    return () => document.removeEventListener('visibilitychange', changed)
  }, [])
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null)
  const speechPlaying = playingMessageId !== null
  const playbackChanged = useCallback((playing: boolean, messageId: string) => {
    setPlayingMessageId((current) => playing ? messageId : current === messageId ? null : current)
  }, [])
  const interview = state.interview
  const newSpeech = useNewInterviewSpeech(interview)
  const terminal = abandoned || interview?.status === 'abandoned' || interview?.status === 'completed' || interview?.status === 'expired'
  const recordingWarning = <RecordingUnsavedChanges textDraft={Boolean(draftText)} dirty={!terminal && (Boolean(draftText) || Boolean(recorder.recording) || recorder.status === 'recording' || recorder.status === 'requesting' || recorder.status === 'finalizing')} />
  const { status: recordingStatus, reset: resetRecording } = recorder
  useEffect(() => {
    // Saved progress from another tab must release capture for the previous prompt.
    const changed = previousContext.current !== draftContext
    previousContext.current = draftContext
    if (terminal || changed) {
      reviewGeneration.current++
      captureTicket.current = null
      if (recordingStatus !== 'idle') resetRecording()
    }
  }, [terminal, draftContext, recordingStatus, resetRecording])
  const autoPrompt = interview ? currentInterviewPrompt(interview).reply : undefined
  const thinkingTime = useAutomaticMicrophone({
    promptId: autoPrompt?.id,
    enabled: microphone.automatic,
    seconds: microphone.seconds,
    paused: terminal || !pageVisible || settingsOpen || skipOpen || interview?.status !== 'active' || speechPlaying || state.loading || Boolean(state.loadError) || state.busy || Boolean(state.unresolved) || state.skipPending || Boolean(recorder.error) || reviewPending || savingRecording || Boolean(interview?.operations.some((item) => item.kind === 'turn' && (item.status === 'pending' || item.status === 'running'))),
    answered: Boolean(draftText) || recorder.status !== 'idle' || Boolean(recorder.recording),
    start: startCapture,
  })
  if (!interview || state.loadError) return <>
    {recordingWarning}
    <div className="grid gap-3">
      <p role={state.loadError ? 'alert' : 'status'}>{state.loadError ? 'Could not load this interview. It may be unavailable, expired, or outside your account.' : 'Loading saved interview…'}</p>
      {state.loadError && <Link className="text-sm underline underline-offset-4" to="/interviews">Back to interviews</Link>}
      {state.loadError && <Button variant="outline" onClick={() => void state.checkSavedStatus()}>Check saved status</Button>}
    </div>
  </>
  if (interview.status === 'completed') return <>{recordingWarning}<CompletedInterviewReview interview={interview} /></>
  if (interview.executionMode !== 'real') return <div className="grid gap-3">
    <p>This older scripted session is retired. Start a real spoken interview to continue.</p>
    <Link className="justify-self-start text-sm underline underline-offset-4" to="/interviews">Start a new interview</Link>
  </div>
  const abandonControl = <AbandonInterviewButton beforeStart={interview.status === 'preparing' || interview.status === 'ready'} busy={state.busy || savingRecording} textDraft={Boolean(draftText)} dirty={Boolean(draftText) || Boolean(recorder.recording) || recorder.status === 'recording' || (recorder.status === 'requesting' || recorder.status === 'finalizing')} error={state.error} abandon={state.abandonInterview} onAbandoned={() => setAbandoned(true)} />
  const recentLink = <Link className="justify-self-start text-sm underline underline-offset-4" to="/interviews">Recent interviews</Link>
  if (abandoned || interview.status === 'abandoned') return <>{recordingWarning}<Navigate to="/interviews" replace state={{ interviewEnded: 'abandoned' }} /></>
  if (interview.status === 'expired') return <>{recordingWarning}<div className="grid gap-2"><h2 className="text-xl font-semibold">Interview expired</h2><p>This interview can no longer be continued. Start a new interview when you’re ready.</p></div>{recentLink}</>
  if (interview.status === 'preparing' || interview.status === 'ready') return <>{recordingWarning}<InterviewPreparation interview={interview} busy={state.busy} error={state.error} disconnected={Boolean(state.subscriptionError)} retry={state.retryOperation} refresh={() => state.checkSavedStatus()} begin={state.beginInterview} />{abandonControl}<InterviewPrivacy /></>
  const browserSpeech = interview.speechPlaybackMode === 'browser'
  const operations = interview.operations
  const currentTurn = operations.filter((operation) => operation.kind === 'turn').at(-1)
  const { question, reply } = currentInterviewPrompt(interview)
  const speech = reply && operations.find((operation) => operation.messageId === reply.id && operation.kind === 'speech')
  const turnActive = currentTurn?.status === 'pending' || currentTurn?.status === 'running'
  const hasQuestionText = Boolean(question && reply?.content.trim())
  const historyMessages = interview.messages
  const canRecord = interview.status === 'active' && hasQuestionText && !state.loading && !state.loadError && !state.busy && !state.unresolved && !state.skipPending && !turnActive && !speechPlaying
  async function transcribe() {
    if (!recorder.recording || submitting.current || !canRecord) return
    const generation = ++reviewGeneration.current
    const ticket = captureTicket.current ?? draft.beginCapture()
    captureTicket.current = null
    submitting.current = true; setSavingRecording(true)
    try {
      const operationId = await state.transcribeRecording(recorder.recording)
      if (operationId) {
        if (mountedReview.current && reviewGeneration.current === generation) setRecordedReview({ id: operationId, context: draftContext, ticket })
        else if (mountedReview.current) void state.cancelTranscription(operationId)
      }
    } finally { submitting.current = false; setSavingRecording(false) }
  }
  const recordingLocked = state.busy || savingRecording || Boolean(state.unresolved)
  const transcriptionSettingsLocked = ['requesting', 'recording', 'finalizing'].includes(recorder.status) || recordingLocked || turnActive
  function switchTranscriptionMode(mode: TranscriptionMode) {
    cancelReview()
    draft.setText('')
    recorder.reset()
    setReviewedRecording(null)
    setTranscriptionMode(mode)
    setPendingTranscriptionMode(null)
  }
  const roomTitle = interview.status === 'completed' ? 'Interview complete'
    : savingRecording || reviewPending ? 'Transcribing your recording'
    : state.unresolved && !state.busy ? 'Check your submission'
    : state.busy ? 'Saving changes'
    : turnActive ? 'Your interviewer is thinking'
    : recorder.status === 'finalizing' ? 'Finalizing your transcript'
    : recorder.status === 'recording' ? 'Your turn — recording'
    : recorder.status === 'requesting' ? 'Allow microphone access'
    : draftText || recorder.candidateTranscript ? 'Review your answer'
    : recorder.recording ? 'Review your recording'
    : !hasQuestionText ? 'Waiting for your question'
    : speechPlaying ? 'Your interviewer is speaking'
    : 'Your turn'
  return <>
    {recordingWarning}
    <div className="flex flex-wrap items-center justify-end gap-3">
      {interview.status === 'active' && abandonControl}
      {interview.status === 'active' && <Dialog open={settingsOpen} onOpenChange={(open) => { setSettingsOpen(open); if (!open) setPendingTranscriptionMode(null) }}>
        <DialogTrigger asChild><Button variant="ghost" size="icon" className="size-11" aria-label="Interview settings" title="Interview settings"><Settings aria-hidden="true" /></Button></DialogTrigger>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Interview settings</DialogTitle>
            <DialogDescription>Choose when the microphone opens and how your answers are transcribed. These settings are remembered for future interviews.</DialogDescription>
          </DialogHeader>
          <InterviewMicrophoneSettings microphone={microphone} />
          <label className="grid max-w-md gap-2 text-sm" htmlFor="interview-transcription-mode">Answer transcription
            <select id="interview-transcription-mode" aria-describedby="interview-transcription-help interview-transcription-recovery" className="min-h-11 rounded-md border bg-background px-3 py-2" value={transcriptionMode} disabled={transcriptionSettingsLocked} onChange={(event) => {
              const mode = event.target.value as TranscriptionMode
              if (mode === transcriptionMode) return
              if (draftText || recorder.recording) setPendingTranscriptionMode(mode)
              else switchTranscriptionMode(mode)
            }}>
              <option value="browser">Browser recognition</option><option value="streaming">Streaming transcription</option><option value="recorded">Recorded audio transcription</option>
            </select>
          </label>
          <p id="interview-transcription-help" className="text-sm leading-relaxed text-muted-foreground">{TRANSCRIPTION_HELP[transcriptionMode]}</p>
          <p id="interview-transcription-recovery" className="text-sm leading-relaxed text-muted-foreground">If browser recognition gives missing or inaccurate words, try Streaming transcription or Recorded audio transcription. Changing modes discards your current recording and answer text so you can start again. You can always type or correct your answer.</p>
          {pendingTranscriptionMode && <div className="grid gap-3 border-t pt-4">
            <p role="alert" className="text-sm">Switching modes will discard your current recording and answer text.</p>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => setPendingTranscriptionMode(null)}>Keep current mode</Button>
              <Button variant="destructive" disabled={transcriptionSettingsLocked} onClick={() => switchTranscriptionMode(pendingTranscriptionMode)}>Discard and switch</Button>
            </div>
          </div>}
          {transcriptionSettingsLocked && <p className="text-sm text-muted-foreground">Stop recording and wait for processing to finish before changing the mode for your next recording.</p>}
        </DialogContent>
      </Dialog>}
    </div>
    {(state.loadError || state.subscriptionError) && <div className="grid gap-2"><p role="alert">Live updates are unavailable. Check saved status to recover the current state.</p><Button variant="outline" className="justify-self-start" disabled={state.busy} onClick={() => void state.checkSavedStatus()}>Check saved status</Button></div>}
    <div className="interview-room">
    <section aria-label="Current interview turn" className="interview-stage" data-recording={recorder.status === 'recording'} data-speaking={speechPlaying}>
      <div className="interview-presence" aria-hidden="true"><AudioLines size={32} strokeWidth={1.5} /></div>
      {question && <p className="text-sm text-muted-foreground">Question {interview.questions.toSorted((a, b) => a.position - b.position).findIndex((item) => item.id === question.id) + 1} of {interview.questions.length}{reply?.kind === 'follow_up' && ` · Follow-up ${interview.messages.filter((message) => message.questionId === question.id && message.kind === 'follow_up' && message.position <= reply.position).length}`}</p>}
      <p className="interview-identity">{interviewerOptions.find((option) => option.value === interview.setup?.interviewer)?.label ?? 'Your interviewer'}</p>
      <div role="status" aria-live="polite" aria-busy={savingRecording || reviewPending || state.busy || turnActive} className="grid gap-2">
        <h2 className="interview-status">{thinkingTime !== null ? `Thinking time — mic opens in ${thinkingTime}s` : roomTitle}</h2>
        {interview.status === 'completed' && <p className="text-sm text-muted-foreground">Your conversation is saved.</p>}
        {turnActive && <p className="text-sm text-muted-foreground">We’re processing your answer and preparing the next reply. You can reload safely.</p>}
        {savingRecording && <p className="text-sm text-muted-foreground">Your recording is being uploaded for transcription. Review and edit the text before submitting.</p>}
      </div>
    {question && !reply && interview.status === 'active' && <p className="interview-question whitespace-pre-wrap break-words">{question.content}</p>}
    {reply && <div className="grid gap-4">
      {reply.acknowledgement && <p className="max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed">{reply.acknowledgement}</p>}
      <p className="interview-question whitespace-pre-wrap break-words">{reply.content}</p>
      <div className="interview-question-actions" role="group" aria-label="Question controls">
      {interview.status === 'active' && interview.executionMode === 'real' && <InterviewClarification key={`clarification:${reply.id}`} interviewId={id} message={reply} disabled={turnActive || state.busy} />}
      {browserSpeech && <BrowserInterviewSpeech key={reply.id} messageId={reply.id} text={reply.spokenContent ?? reply.content} automatic={newSpeech.messageId === reply.id} onAutomaticAttempt={newSpeech.consume} muted={muted} disabled={(recorder.status === 'requesting' || recorder.status === 'finalizing') || recorder.status === 'recording'} otherSpeechPlaying={speechPlaying && playingMessageId !== reply.id} onPlayingChange={playbackChanged} />}
      {!browserSpeech && speech?.status === 'accepted' && <InterviewAudio key={reply.id} interviewId={id} messageId={reply.id} automatic={newSpeech.messageId === reply.id} onAutomaticAttempt={newSpeech.consume} muted={muted} disabled={(recorder.status === 'requesting' || recorder.status === 'finalizing') || recorder.status === 'recording'} otherSpeechPlaying={speechPlaying && playingMessageId !== reply.id} onPlayingChange={playbackChanged} />}
      <Button variant="ghost" size="icon" className="size-11" aria-label={muted ? 'Unmute interviewer' : 'Mute interviewer'} title={muted ? 'Unmute interviewer' : 'Mute interviewer'} aria-pressed={muted} onClick={() => setMuted(!muted)}>{muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}</Button>
      </div>
      {!browserSpeech && (speech?.status === 'failed' || speech?.status === 'expired') && <div className="grid gap-2"><p role="alert">Speech unavailable: {speech.failureCode?.replaceAll('_', ' ') || 'speech failed'}. Saved dialogue is unchanged.</p>{speech.canRetry ? <Button className="justify-self-start" variant="outline" disabled={state.busy} onClick={() => void state.retryOperation(speech.id)}>Retry speech</Button> : <p className="text-sm">This speech cannot be retried. Its audio may have expired or reached the recovery limit.</p>}</div>}
    </div>}
    {state.unresolved && !savingRecording && !state.busy && <div className="grid gap-3 border-t pt-5"><p role="alert">The submission response was not confirmed. Check saved status before retrying. If an unsaved answer cannot be recovered, you will need to type it again after reloading. Your reviewed text is never replaced by recording transcription.</p><div className="flex flex-wrap gap-3"><Button variant="outline" disabled={state.busy} onClick={() => void state.checkSavedStatus()}>Check saved status</Button><Button disabled={state.busy || state.loading || Boolean(state.loadError)} onClick={() => void state.checkSavedStatus(true)}>Retry same submission</Button></div></div>}
    {(currentTurn?.status === 'failed' || currentTurn?.status === 'expired') && <div className="grid gap-2"><p role="alert">Answer failed: {currentTurn.failureCode?.replaceAll('_', ' ') || 'execution failed'}.</p>{currentTurn.canRetry ? <Button className="justify-self-start" variant="outline" disabled={state.busy} onClick={() => void state.retryOperation(currentTurn.id)}>Retry answer processing</Button> : <p className="text-sm">Record a new answer to continue.</p>}</div>}
    {interview.status === 'active' && <div className="grid gap-4 border-t pt-5">
      {state.skipPending && !state.busy && <p role="status" className="text-sm text-muted-foreground">The skip response was not confirmed. Retry skip to check the same question safely before answering.</p>}
      <SkipInterviewQuestionButton pending={state.skipPending} dirty={Boolean(draftText) || Boolean(recorder.recording)} disabled={(!canRecord && !state.skipPending) || turnActive || state.loading || Boolean(state.loadError) || Boolean(state.unresolved) || speechPlaying || reviewPending || savingRecording || recorder.status === "recording" || recorder.status === "requesting" || recorder.status === "finalizing"} busy={state.busy} error={state.error} skip={state.skipQuestion} onOpenChange={setSkipOpen} onSkipped={() => { cancelReview(); draft.setText(""); recorder.reset() }} />
      <AnswerEditor recordingControls={recorder.status === 'recording' ? <Button variant="destructive" onClick={recorder.stop}><Square size={20} fill="currentColor" />{recorder.fallbackReason ? 'Stop recording to transcribe' : 'Stop recording'}</Button> : <Button variant="outline" disabled={!canRecord || (recorder.status === 'requesting' || recorder.status === 'finalizing') || recorder.status === 'ready'} onClick={startCapture}><Mic size={24} />{recorder.status === 'finalizing' ? 'Finalizing answer…' : recorder.status === 'requesting' ? 'Requesting microphone…' : 'Record answer'}</Button>} text={draftText} onTextChange={(text) => {
        if (recorder.status === 'recording' || recorder.status === 'requesting' || recorder.status === 'finalizing') draft.editCapture(text)
        else { cancelReview(); draft.setText(text) }
      }}
        capturing={recorder.status === 'recording' || recorder.status === 'requesting' || recorder.status === 'finalizing'}
        disabled={!canRecord}
        onSubmit={async (text) => {
          cancelReview()
          const saved = await state.answerText(text)
          if (saved) { draft.setText(''); recorder.reset() }
          return saved
        }} />
      {recorder.recording && <div className="flex flex-wrap gap-3 [&_button]:min-h-11">
          {!recorder.candidateTranscript && !recordedReview && reviewedRecording !== recorder.recording && <Button disabled={!canRecord || savingRecording} aria-busy={savingRecording} onClick={() => void transcribe()}>{savingRecording && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}{savingRecording ? 'Transcribing recording…' : 'Transcribe recording'}</Button>}
          <Button variant="outline" disabled={recordingLocked} onClick={discardRecording}>Discard recording</Button>
          <Button variant="outline" disabled={!canRecord || savingRecording} onClick={startCapture}>Re-record</Button>
      </div>}
      {recorder.status === 'finalizing' && <p role="status">Finalizing recognition before review…</p>}
      {reviewPending && <div className="grid gap-2"><p role="status">Transcribing your recording… You can type a replacement answer to cancel transcription.</p><Button variant="outline" disabled={state.busy} onClick={cancelReview}>Cancel transcription</Button></div>}
      {!recordedReview && reviewOperation?.status === 'accepted' && reviewOperation.reviewTranscript && <Button variant="outline" onClick={() => {
        const ticket = draft.beginCapture()
        finishCapture(ticket, reviewOperation.reviewTranscript!)
        setRecordedReview({ id: reviewOperation.id, context: draftContext, ticket: null })
      }}>Review saved transcript</Button>}
      {(reviewOperation?.status === 'failed' || reviewOperation?.status === 'expired') && <div className="grid gap-2"><p role="alert">Transcription unavailable. Your recording and any edited text are retained.</p>{reviewOperation.canRetry && <Button variant="outline" disabled={state.busy} onClick={() => void state.retryOperation(reviewOperation.id)}>Retry transcription</Button>}</div>}
      {recorder.recording && <RecordingReview recording={recorder.recording} />}
      {recorder.status === 'recording' && <p role="status">Recording… Stop within 2 minutes.</p>}
      {recorder.status === 'recording' && recorder.effectiveMode !== 'recorded' && !recorder.transcript && !recorder.fallbackReason && <div role="status" className="grid gap-1 text-sm"><p className="font-medium">Listening for words…</p><p>If you are speaking and no words appear in Your answer, finish recording and choose Transcribe recording. You can also type your answer.</p></div>}
      {recorder.status === 'recording' && recorder.effectiveMode === 'recorded' && !recorder.fallbackReason && <p className="text-sm text-muted-foreground">This mode records audio first. Finish recording, then choose Transcribe recording to see the words.</p>}
      {recorder.fallbackReason && <div role="status" className="grid gap-1 text-sm"><p className="font-medium">Live transcription stopped</p><p>{recorder.fallbackReason}</p><p>{recorder.status === 'recording' ? 'Your microphone is still recording. Stop recording, then choose Transcribe recording to review the words.' : recorder.status === 'finalizing' ? 'Your recording is being finalized. Transcribe recording will be available when it is ready.' : savingRecording || reviewPending ? 'Transcribing your retained recording. Your edited answer stays under your control.' : recordedReview || reviewedRecording === recorder.recording ? 'Review and edit your answer before submitting. Your recording is retained.' : 'Choose Transcribe recording to review the words before submitting, or type your answer. Your recording and edited text are retained.'}</p></div>}
      {!browserSpeech && hasQuestionText && speech?.status !== 'accepted' && <p className="text-sm text-muted-foreground">You can read the question and record your answer while interviewer audio is unavailable.</p>}
      {recorder.error && <p role="alert" className="text-destructive">{recorder.error}</p>}
    </div>}
    {state.error && <p role="alert" className="text-destructive">{state.error}</p>}
    </section>
    <aside className="interview-transcript" aria-label="History">
      <h2 className="mb-4 text-lg font-semibold">History</h2>
      <ol className="interview-exchanges">
        {historyMessages.map((message) => <li key={message.id} className="interview-exchange" data-speaker={message.kind === 'answer' ? 'you' : 'interviewer'}>
          <p className="text-sm font-medium">{message.kind === 'answer' ? 'Your transcript' : 'Interviewer'}</p>
          {message.acknowledgement && <p className="max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed">{message.acknowledgement}</p>}
          <p className="max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</p>
        </li>)}
      </ol>
      {!historyMessages.length && <p className="text-sm text-muted-foreground">Your conversation will appear here as the interview progresses.</p>}
    </aside>
    </div>
    {interview.status === 'active' && <InterviewPrivacy />}
  </>
}

function ProviderNotice() {
  return <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">Career details and your chosen focus go to TypeSafe for screening and OpenAI for interview preparation. Browser recognition may use your browser’s remote speech service. Streaming mode sends audio to OpenAI while you speak; recorded mode and recognition fallback send the complete recording to OpenAI for transcription before you review and submit your answer. Screened text goes to TypeSafe and OpenAI for interview replies. Interviewer text is read by your browser’s voice by default. When provider speech is enabled, saved text goes to OpenAI to generate audio. Provider requests incur charges; no coaching is provided.</p>
}
