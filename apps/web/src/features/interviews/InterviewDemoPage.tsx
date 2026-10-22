/** Keep the current interview turn in focus, with earlier dialogue and details nearby.
 * Saved text permits answering even when speech fails; actual playback and capture never overlap.
 * Saved server state controls progression; recording, review and submission remain explicit.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { PageHeading } from '@/components/PageHeading'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Mic, Square, AudioLines, LoaderCircle } from 'lucide-react'
import './interviewRoom.css'
import { useAuth } from '@/features/auth/useAuth'
import { currentInterviewPrompt } from './currentInterviewPrompt'
import { interviewDemoEnabled } from './interviewDemoEnabled'
import { InterviewPreparation } from './InterviewPreparation'
import { AbandonInterviewButton } from './AbandonInterviewButton'
import { RecentInterviews } from './RecentInterviews'
import { RecordingReview } from './RecordingReview'
import { RecordingUnsavedChanges } from './RecordingUnsavedChanges'
import { BrowserInterviewSpeech } from './BrowserInterviewSpeech'
import { InterviewAudio } from './InterviewAudio'
import { useNewInterviewSpeech } from './useNewInterviewSpeech'
import { useTranscriptionPreference } from './useTranscriptionPreference'
import { useInterviewRecorder } from './useInterviewRecorder'
import { useInterviewStreaming } from './useInterviewStreaming'
import { useInterviewSession, useStartInterview } from './useInterviewSession'

export function InterviewDemoPage() {
  const { id } = useParams()
  const { user } = useAuth()
  return <div className="interview-page mx-auto grid w-full max-w-6xl gap-6">
    <PageHeading title="Spoken interview" description="Practice a complete interview for a fictional role drawn from your career library." />
    {!interviewDemoEnabled() ? <p>Spoken interviews are unavailable in this environment.</p> : id ? <OwnedInterview key={`${user?.id}:${id}`} id={id} /> : <><StartDemo /><RecentInterviews /></>}
    <details className="border-t pt-4 text-sm text-muted-foreground">
      <summary className="cursor-pointer py-2 font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring">Interview details and privacy</summary>
      <div className="grid gap-3 pt-3">
        <p className="max-w-prose leading-relaxed">Record up to 2 minutes / 10 MiB. Source audio is deleted after success or permanent failure; abandoned uploads expire after 1 hour. Saved speech expires 1 hour after completion; saved text lasts 7 days.</p>
        <ProviderNotice />
      </div>
    </details>
    <Link className="justify-self-start text-sm underline underline-offset-4" to="/interview-prep">Open written interview practice</Link>
  </div>
}
function StartDemo() {
  const { start, loading, error } = useStartInterview()
  const navigate = useNavigate()
  const [careerFocus, setCareerFocus] = useState('')
  async function begin() { const id = await start(careerFocus); if (id) void navigate(`/interviews/demo/${id}`) }
  return <div className="grid gap-3">
    <p className="max-w-prose text-sm">Prepare nine questions: three behavioral, three technical and three knowledge questions. Review the fictional role before starting.</p>
    <label className="grid max-w-lg gap-2 text-sm" htmlFor="interview-career-focus">Career focus (optional)<Input id="interview-career-focus" maxLength={200} value={careerFocus} onChange={(event) => setCareerFocus(event.target.value)} aria-describedby="interview-focus-help" /></label>
    <p id="interview-focus-help" className="max-w-prose text-sm text-muted-foreground">If your library covers several careers, name the work you want to practise. Otherwise, we will choose a coherent role from the available details.</p>
    <Link className="justify-self-start text-sm underline underline-offset-4" to="/library">Review your career library</Link>
    <ProviderNotice />
    <Button className="justify-self-start" disabled={loading} onClick={() => void begin()}>{loading ? 'Preparing…' : 'Prepare interview'}</Button>
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>
}
function OwnedInterview({ id }: { id: string }) {
  const { user } = useAuth()
  const state = useInterviewSession(id, user?.id ?? '')
  const [transcriptionMode, setTranscriptionMode] = useTranscriptionPreference(user?.id ?? '')
  const startStreaming = useInterviewStreaming(state.interview)
  const recorder = useInterviewRecorder({ mode: transcriptionMode, startStreaming })
  const submitting = useRef(false)
  const [savingRecording, setSavingRecording] = useState(false)
  const [muted, setMuted] = useState(false)
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null)
  const speechPlaying = playingMessageId !== null
  const playbackChanged = useCallback((playing: boolean, messageId: string) => {
    setPlayingMessageId((current) => playing ? messageId : current === messageId ? null : current)
  }, [])
  const recordingWarning = <RecordingUnsavedChanges dirty={Boolean(recorder.recording) || recorder.status === 'recording' || (recorder.status === 'requesting' || recorder.status === 'finalizing')} />
  const interview = state.interview
  const newSpeech = useNewInterviewSpeech(interview)
  const terminal = interview?.status === 'abandoned' || interview?.status === 'completed' || interview?.status === 'expired'
  const { status: recordingStatus, reset: resetRecording } = recorder
  useEffect(() => {
    // A saved update from another tab must release local capture too.
    if (terminal && recordingStatus !== 'idle') resetRecording()
  }, [terminal, recordingStatus, resetRecording])
  if (!interview || state.loadError) return <>
    {recordingWarning}
    <div className="grid gap-3">
      <p role={state.loadError ? 'alert' : 'status'}>{state.loadError ? 'Could not load this interview. It may be unavailable, expired, or outside your account.' : 'Loading saved interview…'}</p>
      {state.loadError && <Button variant="outline" onClick={() => void state.checkSavedStatus()}>Check saved status</Button>}
    </div>
  </>
  if (interview.executionMode !== 'real') return <div className="grid gap-3">
    <p>This older scripted session is retired. Start a real spoken interview to continue.</p>
    <Link className="justify-self-start text-sm underline underline-offset-4" to="/interviews/demo">Start a new interview</Link>
  </div>
  const abandonControl = <AbandonInterviewButton busy={state.busy || savingRecording} dirty={Boolean(recorder.recording) || recorder.status === 'recording' || (recorder.status === 'requesting' || recorder.status === 'finalizing')} error={state.error} abandon={state.abandonInterview} onAbandoned={recorder.reset} />
  const recentLink = <Link className="justify-self-start text-sm underline underline-offset-4" to="/interviews/demo">Recent interviews</Link>
  if (interview.status === 'abandoned') return <>{recordingWarning}<p role="status">This interview was abandoned. It cannot be continued. Audio is queued for deletion.</p>{recentLink}</>
  if (interview.status === 'expired') return <>{recordingWarning}<div className="grid gap-2"><h2 className="text-xl font-semibold">Interview expired</h2><p>This interview can no longer be continued. Start a new interview when you’re ready.</p></div>{recentLink}</>
  if (interview.status === 'preparing' || interview.status === 'ready') return <>{recordingWarning}{recentLink}<InterviewPreparation interview={interview} busy={state.busy} error={state.error} disconnected={Boolean(state.subscriptionError)} retry={state.retryOperation} refresh={() => state.checkSavedStatus()} begin={state.beginInterview} />{abandonControl}</>
  const browserSpeech = interview.speechPlaybackMode === 'browser'
  const operations = interview.operations
  const currentTurn = operations.filter((operation) => operation.kind === 'turn').at(-1)
  const { question, reply } = currentInterviewPrompt(interview)
  const speech = reply && operations.find((operation) => operation.messageId === reply.id && operation.kind === 'speech')
  const turnActive = currentTurn?.status === 'pending' || currentTurn?.status === 'running'
  const hasQuestionText = Boolean(question && reply?.content.trim())
  const earlierMessages = interview.messages.filter((message) => message.id !== reply?.id && !(
    interview.status === 'active' && message.questionId === question?.id && message.kind === 'opening' && message.content === question.content
  ))
  const canRecord = interview.status === 'active' && hasQuestionText && !state.loading && !state.loadError && !state.busy && !state.unresolved && !turnActive && !speechPlaying
  async function submit() {
    if (!recorder.recording || submitting.current || !canRecord) return
    submitting.current = true; setSavingRecording(true)
    try {
      const saved = recorder.candidateTranscript ? await state.answer(recorder.recording, recorder.candidateTranscript, transcriptionMode) : await state.answer(recorder.recording)
      if (saved) recorder.reset()
    }
    finally { submitting.current = false; setSavingRecording(false) }
  }
  const recordingLocked = state.busy || savingRecording || Boolean(state.unresolved)
  const roomTitle = interview.status === 'completed' ? 'Interview complete'
    : savingRecording ? 'Saving your answer'
    : state.unresolved && !state.busy ? 'Check your submission'
    : state.busy ? 'Saving changes'
    : turnActive ? 'Your interviewer is thinking'
    : recorder.status === 'finalizing' ? 'Finalizing your transcript'
    : recorder.status === 'recording' ? 'Your turn — recording'
    : recorder.status === 'requesting' ? 'Allow microphone access'
    : recorder.recording ? 'Review your recording'
    : !hasQuestionText ? 'Waiting for your question'
    : speechPlaying ? 'Your interviewer is speaking'
    : 'Your turn'
  return <>
    {recordingWarning}
    <div className="interview-progress flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      {question && <p>Question {question.position + 1} of {interview.questions.length}{question.questionType ? ` · ${question.questionType.charAt(0).toUpperCase()}${question.questionType.slice(1)}` : ''}</p>}
      {recentLink}
    </div>
    <div className="interview-progress-track" role="progressbar" aria-label="Interview progress" aria-valuemin={0} aria-valuemax={interview.questions.length} aria-valuenow={interview.status === 'completed' ? interview.questions.length : interview.currentQuestionPosition}>
      <div style={{ width: `${interview.questions.length ? (interview.status === 'completed' ? 100 : interview.currentQuestionPosition / interview.questions.length * 100) : 0}%` }} />
    </div>
    {(state.loadError || state.subscriptionError) && <div className="grid gap-2"><p role="alert">Live updates are unavailable. Check saved status to recover the current state.</p><Button variant="outline" className="justify-self-start" disabled={state.busy} onClick={() => void state.checkSavedStatus()}>Check saved status</Button></div>}
    <div className="interview-room">
    <section aria-label="Current interview turn" className="interview-stage" data-recording={recorder.status === 'recording'} data-speaking={speechPlaying}>
      <div className="interview-presence" aria-hidden="true"><AudioLines size={32} strokeWidth={1.5} /></div>
      <p className="interview-identity">Your interviewer</p>
      <div role="status" aria-live="polite" aria-busy={savingRecording || state.busy || turnActive} className="grid gap-2">
        <h2 className="interview-status">{roomTitle}</h2>
        {interview.status === 'completed' && <p className="text-sm text-muted-foreground">Your conversation is saved.</p>}
        {turnActive && <p className="text-sm text-muted-foreground">We’re processing your answer and preparing the next reply. You can reload safely.</p>}
        {savingRecording && <p className="text-sm text-muted-foreground">Keep this page open while your recording is submitted.</p>}
      </div>
    {question && interview.status === 'active' && <p className="interview-question whitespace-pre-wrap break-words">{question.content}</p>}
    {reply && <div className="grid gap-4">
      {(reply.content !== question?.content || interview.status === 'completed') && <div className="grid gap-2">
        {interview.status === 'active' && <h3 className="text-base font-semibold">Follow-up</h3>}
        <p className="interview-question whitespace-pre-wrap break-words">{reply.content}</p>
      </div>}
      {browserSpeech && <BrowserInterviewSpeech key={reply.id} messageId={reply.id} text={reply.content} automatic={newSpeech.messageId === reply.id} onAutomaticAttempt={newSpeech.consume} muted={muted} disabled={(recorder.status === 'requesting' || recorder.status === 'finalizing') || recorder.status === 'recording'} otherSpeechPlaying={speechPlaying && playingMessageId !== reply.id} onPlayingChange={playbackChanged} />}
      {!browserSpeech && speech?.status === 'accepted' && <InterviewAudio key={reply.id} interviewId={id} messageId={reply.id} automatic={newSpeech.messageId === reply.id} onAutomaticAttempt={newSpeech.consume} muted={muted} disabled={(recorder.status === 'requesting' || recorder.status === 'finalizing') || recorder.status === 'recording'} otherSpeechPlaying={speechPlaying && playingMessageId !== reply.id} onPlayingChange={playbackChanged} />}
      <Button variant="ghost" className="justify-self-start" aria-pressed={muted} onClick={() => setMuted(!muted)}>{muted ? 'Unmute interviewer' : 'Mute interviewer'}</Button>
      {!browserSpeech && (speech?.status === 'failed' || speech?.status === 'expired') && <div className="grid gap-2"><p role="alert">Speech unavailable: {speech.failureCode?.replaceAll('_', ' ') || 'speech failed'}. Saved dialogue is unchanged.</p>{speech.canRetry ? <Button className="justify-self-start" variant="outline" disabled={state.busy} onClick={() => void state.retryOperation(speech.id)}>Retry speech</Button> : <p className="text-sm">This speech cannot be retried. Its audio may have expired or reached the recovery limit.</p>}</div>}
    </div>}
    {state.unresolved && !savingRecording && !state.busy && <div className="grid gap-3 border-t pt-5"><p role="alert">The submission response was not confirmed. Check saved status before retrying. If an unsaved recognized answer cannot be recovered, retry uses its retained recording for transcription.</p><div className="flex flex-wrap gap-3"><Button variant="outline" disabled={state.busy} onClick={() => void state.checkSavedStatus()}>Check saved status</Button><Button disabled={state.busy || state.loading || Boolean(state.loadError)} onClick={() => void state.checkSavedStatus(true)}>Retry same submission</Button></div></div>}
    {(currentTurn?.status === 'failed' || currentTurn?.status === 'expired') && <div className="grid gap-2"><p role="alert">Answer failed: {currentTurn.failureCode?.replaceAll('_', ' ') || 'execution failed'}. This did not use a response slot.</p>{currentTurn.canRetry ? <Button className="justify-self-start" variant="outline" disabled={state.busy} onClick={() => void state.retryOperation(currentTurn.id)}>Retry answer processing</Button> : <p className="text-sm">Record a new answer to continue.</p>}</div>}
    {interview.status === 'active' && <div className="grid gap-4 border-t pt-5">
      <label className="grid max-w-md gap-2 text-sm" htmlFor="interview-transcription-mode">Answer transcription
        <select id="interview-transcription-mode" className="rounded-md border bg-background px-3 py-2" value={transcriptionMode} disabled={recorder.status !== 'idle' || recordingLocked || turnActive} onChange={(event) => setTranscriptionMode(event.target.value as typeof transcriptionMode)}>
          <option value="browser">Browser recognition</option><option value="streaming">Streaming transcription</option><option value="recorded">Recorded audio transcription</option>
        </select>
      </label>
      <p className="text-sm text-muted-foreground">{recorder.status === 'idle' ? 'Selected mode' : 'Effective mode'}: {({ browser: 'Browser recognition', streaming: 'Streaming transcription', recorded: 'Recorded audio transcription' })[recorder.status === 'idle' ? transcriptionMode : recorder.effectiveMode]}</p>
      {recorder.fallbackReason && <p role="status" className="text-sm">{recorder.fallbackReason}</p>}
      {recorder.transcript && <div className="grid gap-1 text-sm"><p className="font-medium">{recorder.status === 'ready' ? (recorder.candidateTranscript ? 'Recognized answer' : 'Recognition preview — recorded fallback will be used') : 'Live recognition — interim words may change'}</p><p className="whitespace-pre-wrap break-words">{recorder.transcript}</p></div>}
      {recorder.status === 'finalizing' && <p role="status">Finalizing recognition before review…</p>}
      {recorder.recording && <RecordingReview recording={recorder.recording} />}
      <div className="interview-record-controls">
        {recorder.status === 'recording' ? <Button className="interview-mic" onClick={recorder.stop}><Square size={20} fill="currentColor" />Done answering</Button> : <Button className="interview-mic" disabled={!canRecord || (recorder.status === 'requesting' || recorder.status === 'finalizing') || recorder.status === 'ready'} onClick={() => void recorder.start()}><Mic size={24} />{recorder.status === 'finalizing' ? 'Finalizing answer…' : recorder.status === 'requesting' ? 'Requesting microphone…' : 'Record answer'}</Button>}
        {recorder.recording && <><Button disabled={!canRecord || savingRecording} aria-busy={savingRecording} onClick={() => void submit()}>{savingRecording && <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}{savingRecording ? 'Submitting answer…' : 'Submit recording'}</Button><Button variant="outline" disabled={recordingLocked} onClick={recorder.reset}>Discard recording</Button><Button variant="outline" disabled={!canRecord || savingRecording} onClick={() => void recorder.start()}>Re-record</Button></>}
      </div>
      <p className="max-w-prose text-sm text-muted-foreground">{recorder.recording ? 'Your recording is retained until you submit. You can discard it or try again.' : 'Record when you’re ready. Done answering opens a preview before you submit. Silence never submits.'}</p>
      {recorder.status === 'recording' && <p role="status">Recording… Stop within 2 minutes.</p>}
      {!browserSpeech && hasQuestionText && speech?.status !== 'accepted' && <p className="text-sm text-muted-foreground">You can read the question and record your answer while interviewer audio is unavailable.</p>}
      {recorder.error && <p role="alert" className="text-destructive">{recorder.error}</p>}
    </div>}
    {state.error && <p role="alert" className="text-destructive">{state.error}</p>}
    </section>
    <aside className="interview-transcript" aria-label="Saved conversation">
      <h2 className="text-lg font-semibold">Saved conversation</h2>
      <p className="mt-1 text-sm text-muted-foreground">Accepted answers appear here after processing.</p>
      <p className="mb-4 text-sm text-muted-foreground">{question?.acceptedAnswerCount ?? 0} of {interview.answerCap} responses saved.</p>
      <ol className="interview-exchanges">
        {earlierMessages.map((message) => <li key={message.id} className="interview-exchange" data-speaker={message.kind === 'answer' ? 'you' : 'interviewer'}>
          <p className="text-sm font-medium">{message.kind === 'answer' ? 'Your transcript' : 'Interviewer'}</p>
          <p className="max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</p>
          {message.kind !== 'answer' && browserSpeech && <BrowserInterviewSpeech messageId={message.id} text={message.content} muted={muted} disabled={(recorder.status === 'requesting' || recorder.status === 'finalizing') || recorder.status === 'recording'} otherSpeechPlaying={speechPlaying && playingMessageId !== message.id} onPlayingChange={playbackChanged} />}
          {message.kind !== 'answer' && !browserSpeech && operations.some((operation) => operation.messageId === message.id && operation.kind === 'speech' && operation.status === 'accepted') && <InterviewAudio interviewId={id} messageId={message.id} muted={muted} disabled={(recorder.status === 'requesting' || recorder.status === 'finalizing') || recorder.status === 'recording'} otherSpeechPlaying={speechPlaying && playingMessageId !== message.id} onPlayingChange={playbackChanged} />}
        </li>)}
      </ol>
      {!earlierMessages.length && <p className="text-sm text-muted-foreground">Your earlier exchanges will appear here. Focus on the current question when you’re ready.</p>}
    </aside>
    </div>
    {interview.status === 'active' && <div className="border-t pt-4">{abandonControl}</div>}
  </>
}

function ProviderNotice() {
  return <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">Career details and your chosen focus go to TypeSafe for screening and OpenAI for interview preparation. Browser recognition may use your browser’s remote speech service. Streaming mode sends audio to OpenAI while you speak; recorded mode and recognition fallback send the complete submitted recording to OpenAI for transcription. Screened text goes to TypeSafe and OpenAI for interview replies. Interviewer text is read by your browser’s voice by default. When provider speech is enabled, saved text goes to OpenAI to generate audio. Provider requests incur charges; no coaching is provided.</p>
}
