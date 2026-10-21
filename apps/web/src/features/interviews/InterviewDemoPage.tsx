/** Keep the current interview turn in focus, with earlier dialogue and details nearby.
 * Saved server state controls progression; recording, review and submission remain explicit.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { PageHeading } from '@/components/PageHeading'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SectionCard } from '@/components/SectionCard'
import { useAuth } from '@/features/auth/useAuth'
import { interviewDemoEnabled } from './interviewDemoEnabled'
import { InterviewPreparation } from './InterviewPreparation'
import { AbandonInterviewButton } from './AbandonInterviewButton'
import { RecentInterviews } from './RecentInterviews'
import { RecordingReview } from './RecordingReview'
import { RecordingUnsavedChanges } from './RecordingUnsavedChanges'
import { InterviewAudio } from './InterviewAudio'
import { useNewInterviewSpeech } from './useNewInterviewSpeech'
import { useInterviewRecorder } from './useInterviewRecorder'
import { useInterviewSession, useStartInterview } from './useInterviewSession'

export function InterviewDemoPage() {
  const { id } = useParams()
  const { user } = useAuth()
  return <div className="mx-auto grid max-w-3xl gap-6">
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
  const recorder = useInterviewRecorder()
  const submitting = useRef(false)
  const [savingRecording, setSavingRecording] = useState(false)
  const [muted, setMuted] = useState(false)
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null)
  const speechPlaying = playingMessageId !== null
  const playbackChanged = useCallback((playing: boolean, messageId: string) => {
    setPlayingMessageId((current) => playing ? messageId : current === messageId ? null : current)
  }, [])
  const recordingWarning = <RecordingUnsavedChanges dirty={Boolean(recorder.recording) || recorder.status === 'recording' || recorder.status === 'requesting'} />
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
  const abandonControl = <AbandonInterviewButton busy={state.busy || savingRecording} dirty={Boolean(recorder.recording) || recorder.status === 'recording' || recorder.status === 'requesting'} error={state.error} abandon={state.abandonInterview} onAbandoned={recorder.reset} />
  const recentLink = <Link className="justify-self-start text-sm underline underline-offset-4" to="/interviews/demo">Recent interviews</Link>
  if (interview.status === 'abandoned') return <>{recordingWarning}<p role="status">This interview was abandoned. It cannot be continued. Audio is queued for deletion.</p>{recentLink}</>
  if (interview.status === 'expired') return <>{recordingWarning}<div className="grid gap-2"><h2 className="text-xl font-semibold">Interview expired</h2><p>This interview can no longer be continued. Start a new interview when you’re ready.</p></div>{recentLink}</>
  if (interview.status === 'preparing' || interview.status === 'ready') return <>{recordingWarning}{recentLink}<InterviewPreparation interview={interview} busy={state.busy} error={state.error} disconnected={Boolean(state.subscriptionError)} retry={state.retryOperation} refresh={() => state.checkSavedStatus()} begin={state.beginInterview} />{abandonControl}</>
  const operations = interview.operations
  const currentTurn = operations.filter((operation) => operation.kind === 'turn').at(-1)
  const reply = interview.messages.filter((message) => message.kind !== 'answer').at(-1)
  const speech = reply && operations.find((operation) => operation.messageId === reply.id && operation.kind === 'speech')
  const turnActive = currentTurn?.status === 'pending' || currentTurn?.status === 'running'
  const question = interview.questions.find((item) => item.position === interview.currentQuestionPosition)
  const canRecord = interview.status === 'active' && !state.loading && !state.loadError && !state.busy && !state.unresolved && !turnActive && !speechPlaying && speech?.status === 'accepted'
  async function submit() {
    if (!recorder.recording || submitting.current || !canRecord) return
    submitting.current = true; setSavingRecording(true)
    try { if (await state.answer(recorder.recording)) recorder.reset() }
    finally { submitting.current = false; setSavingRecording(false) }
  }
  const recordingLocked = state.busy || savingRecording || Boolean(state.unresolved)
  const roomTitle = interview.status === 'completed' ? 'Interview complete'
    : state.unresolved ? 'Check your submission'
    : savingRecording ? 'Saving your answer'
    : state.busy ? 'Saving changes'
    : turnActive ? 'Your interviewer is thinking'
    : recorder.status === 'recording' ? 'Your turn — recording'
    : recorder.status === 'requesting' ? 'Allow microphone access'
    : recorder.recording ? 'Review your recording'
    : speech?.status === 'failed' || speech?.status === 'expired' ? 'Interviewer audio needs attention'
    : speech?.status !== 'accepted' ? 'Preparing interviewer audio'
    : speechPlaying ? 'Your interviewer is speaking'
    : 'Your turn'
  return <>
    {recordingWarning}
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      {question && <p>Question {question.position + 1} of {interview.questions.length}{question.questionType ? ` · ${question.questionType.charAt(0).toUpperCase()}${question.questionType.slice(1)}` : ''}</p>}
      {recentLink}
    </div>
    {(state.loadError || state.subscriptionError) && <div className="grid gap-2"><p role="alert">Live updates are unavailable. Check saved status to recover the current state.</p><Button variant="outline" className="justify-self-start" disabled={state.busy} onClick={() => void state.checkSavedStatus()}>Check saved status</Button></div>}
    <section aria-label="Current interview turn" className="grid gap-6 rounded-xl border bg-card px-5 py-6 sm:px-8 sm:py-8">
      <div role="status" aria-live="polite" className="grid gap-2">
        <h2 className="text-xl font-semibold tracking-tight">{roomTitle}</h2>
        {interview.status === 'completed' && <p className="text-sm text-muted-foreground">Your conversation is saved.</p>}
        {turnActive && <p className="text-sm text-muted-foreground">We’re processing your answer and preparing the next reply. You can reload safely.</p>}
        {savingRecording && <p className="text-sm text-muted-foreground">Keep this page open while your recording is submitted.</p>}
      </div>
    {reply && <div className="grid gap-4">
      <p className="max-w-prose whitespace-pre-wrap break-words text-lg leading-relaxed sm:text-xl">{reply.content}</p>
      {speech?.status === 'accepted' && <InterviewAudio key={reply.id} interviewId={id} messageId={reply.id} automatic={newSpeech.messageId === reply.id} onAutomaticAttempt={newSpeech.consume} muted={muted} disabled={recorder.status === 'requesting' || recorder.status === 'recording'} otherSpeechPlaying={speechPlaying && playingMessageId !== reply.id} onPlayingChange={playbackChanged} />}
      <Button variant="ghost" className="justify-self-start" aria-pressed={muted} onClick={() => setMuted(!muted)}>{muted ? 'Unmute interviewer' : 'Mute interviewer'}</Button>
      {(speech?.status === 'failed' || speech?.status === 'expired') && <div className="grid gap-2"><p role="alert">Speech unavailable: {speech.failureCode?.replaceAll('_', ' ') || 'speech failed'}. Saved dialogue is unchanged.</p>{speech.canRetry ? <Button className="justify-self-start" variant="outline" disabled={state.busy} onClick={() => void state.retryOperation(speech.id)}>Retry speech</Button> : <p className="text-sm">This speech cannot be retried. Its audio may have expired or reached the recovery limit.</p>}</div>}
    </div>}
    {state.unresolved && <div className="grid gap-3 border-t pt-5"><p role="alert">The submission response was not confirmed. Check saved status or retry the same submission; this keeps the original answer identity.</p><div className="flex flex-wrap gap-3"><Button variant="outline" disabled={state.busy} onClick={() => void state.checkSavedStatus()}>Check saved status</Button><Button disabled={state.busy || state.loading || Boolean(state.loadError)} onClick={() => void state.checkSavedStatus(true)}>Retry same submission</Button></div></div>}
    {(currentTurn?.status === 'failed' || currentTurn?.status === 'expired') && <div className="grid gap-2"><p role="alert">Answer failed: {currentTurn.failureCode?.replaceAll('_', ' ') || 'execution failed'}. This did not use a response slot.</p>{currentTurn.canRetry ? <Button className="justify-self-start" variant="outline" disabled={state.busy} onClick={() => void state.retryOperation(currentTurn.id)}>Retry answer processing</Button> : <p className="text-sm">Record a new answer to continue.</p>}</div>}
    {interview.status === 'active' && <div className="grid gap-4 border-t pt-5">
      {recorder.recording && <RecordingReview recording={recorder.recording} />}
      <div className="flex flex-wrap gap-3">
        {recorder.status === 'recording' ? <Button onClick={recorder.stop}>Done answering</Button> : <Button disabled={!canRecord || recorder.status === 'requesting' || recorder.status === 'ready'} onClick={() => void recorder.start()}>{recorder.status === 'requesting' ? 'Requesting microphone…' : 'Record answer'}</Button>}
        {recorder.recording && <><Button disabled={!canRecord || savingRecording} onClick={() => void submit()}>Submit recording</Button><Button variant="outline" disabled={recordingLocked} onClick={recorder.reset}>Discard recording</Button><Button variant="outline" disabled={!canRecord || savingRecording} onClick={() => void recorder.start()}>Re-record</Button></>}
      </div>
      <p className="max-w-prose text-sm text-muted-foreground">{recorder.recording ? 'Nothing is uploaded until you submit. You can discard this recording or try again.' : 'Record when you’re ready. Done answering opens a preview before you submit. Silence never submits.'}</p>
      {recorder.status === 'recording' && <p role="status">Recording… Stop within 2 minutes.</p>}
      {!canRecord && !turnActive && interview.status === 'active' && speech?.status !== 'accepted' && <p className="text-sm text-muted-foreground">Recording is available once the current reply's speech is ready. Listening first is optional.</p>}
      {recorder.error && <p role="alert" className="text-destructive">{recorder.error}</p>}
    </div>}
    {state.error && <p role="alert" className="text-destructive">{state.error}</p>}
    </section>
    <SectionCard title="Saved conversation" tone="facts" sectionId={`interview:${id}:dialogue`}>
      <p className="mb-4 text-sm text-muted-foreground">{question?.acceptedAnswerCount ?? 0} of {interview.answerCap} responses saved.</p>
      <ol className="divide-y">
        {interview.messages.filter((message) => message.id !== reply?.id).map((message) => <li key={message.id} className="grid gap-3 py-5 first:pt-0 last:pb-0">
          <p className="text-sm font-medium">{message.kind === 'answer' ? 'Your transcript' : 'Interviewer'}</p>
          <p className="max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</p>
          {message.kind !== 'answer' && operations.some((operation) => operation.messageId === message.id && operation.kind === 'speech' && operation.status === 'accepted') && <InterviewAudio interviewId={id} messageId={message.id} muted={muted} disabled={recorder.status === 'requesting' || recorder.status === 'recording'} otherSpeechPlaying={speechPlaying && playingMessageId !== message.id} onPlayingChange={playbackChanged} />}
        </li>)}
      </ol>
      {!interview.messages.some((message) => message.id !== reply?.id) && <p className="text-sm text-muted-foreground">Your earlier exchanges will appear here. The current question is above.</p>}
    </SectionCard>
    {interview.status === 'active' && <div className="border-t pt-4">{abandonControl}</div>}
  </>
}

function ProviderNotice() {
  return <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">Career details and your chosen focus go to TypeSafe for screening and OpenAI for interview preparation. Submitted audio goes to OpenAI for transcription. Screened text goes to TypeSafe and OpenAI for interview replies. The voice is AI-generated. Provider requests incur charges; no coaching is provided.</p>
}
