/** A small spoken demo alongside written practice. Saved server state controls progression;
 * recording is explicit, and fake output is never presented as understanding the microphone.
 */
import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { PageHeading } from '@/components/PageHeading'
import { Button } from '@/components/ui/button'
import { SectionCard } from '@/components/SectionCard'
import { useAuth } from '@/features/auth/useAuth'
import { interviewDemoEnabled } from './interviewDemoEnabled'
import { RecordingReview } from './RecordingReview'
import { RecordingUnsavedChanges } from './RecordingUnsavedChanges'
import { InterviewAudio } from './InterviewAudio'
import { useInterviewRecorder } from './useInterviewRecorder'
import { useInterviewSession, useStartInterview } from './useInterviewSession'

export function InterviewDemoPage() {
  const { id } = useParams()
  const { user } = useAuth()
  return <div className="mx-auto grid max-w-3xl gap-6">
    <PageHeading title="Basic Interview demo" description="Try one spoken question with fictional context." />
    <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">This offline demo uses scripted transcripts and prerecorded synthetic AI speech. It does not transcribe or assess your recording. Your microphone tests private upload, audio validation, and recovery; no coaching is provided.</p>
    <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">Record up to 2 minutes / 10 MiB. Source audio is deleted after success or permanent failure; abandoned uploads expire after 1 hour. Saved speech expires 1 hour after completion; accepted text lasts 7 days.</p>
    <Link className="justify-self-start text-sm underline underline-offset-4" to="/interview-prep">Open written interview practice</Link>
    {!interviewDemoEnabled() ? <p>This demo is disabled. Enable it explicitly in development to continue.</p> : id ? <OwnedInterview key={`${user?.id}:${id}`} id={id} /> : <StartDemo />}
  </div>
}
function StartDemo() {
  const { start, loading, error } = useStartInterview()
  const navigate = useNavigate()
  async function begin() { const id = await start(); if (id) void navigate(`/interviews/demo/${id}`) }
  return <div className="grid gap-3">
    <p className="text-sm">One prepared question, with at most two accepted answers.</p>
    <Button className="justify-self-start" disabled={loading} onClick={() => void begin()}>{loading ? 'Starting…' : 'Start demo'}</Button>
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>
}
function OwnedInterview({ id }: { id: string }) {
  const { user } = useAuth()
  const state = useInterviewSession(id, user?.id ?? '')
  const recorder = useInterviewRecorder()
  const submitting = useRef(false)
  const [savingRecording, setSavingRecording] = useState(false)
  const recordingWarning = <RecordingUnsavedChanges dirty={Boolean(recorder.recording) || recorder.status === 'recording' || recorder.status === 'requesting'} />
  const interview = state.interview
  if (!interview || state.loadError) return <>
    {recordingWarning}
    <div className="grid gap-3">
      <p role={state.loadError ? 'alert' : 'status'}>{state.loadError ? 'Could not load this interview. It may be unavailable, expired, or outside your account.' : 'Loading saved interview…'}</p>
      {state.loadError && <Button variant="outline" onClick={() => void state.checkSavedStatus()}>Check saved status</Button>}
    </div>
  </>
  const operations = interview.operations
  const currentTurn = operations.filter((operation) => operation.kind === 'turn').at(-1)
  const reply = interview.messages.filter((message) => message.kind !== 'answer').at(-1)
  const speech = reply && operations.find((operation) => operation.messageId === reply.id && operation.kind === 'speech')
  const turnActive = currentTurn?.status === 'pending' || currentTurn?.status === 'running'
  const question = interview.questions.find((item) => item.position === interview.currentQuestionPosition)
  const canRecord = interview.status === 'active' && !state.loading && !state.loadError && !state.busy && !state.unresolved && !turnActive && speech?.status === 'accepted'
  async function submit() {
    if (!recorder.recording || submitting.current || !canRecord) return
    submitting.current = true; setSavingRecording(true)
    try { if (await state.answer(recorder.recording)) recorder.reset() }
    finally { submitting.current = false; setSavingRecording(false) }
  }
  const recordingLocked = state.busy || savingRecording || Boolean(state.unresolved)
  return <>
    {recordingWarning}
    <div role="status" aria-live="polite" className="grid gap-2 text-sm">
      <p>{interview.status === 'completed' ? 'Interview complete. Your accepted dialogue is saved.' : `${question?.acceptedAnswerCount ?? 0} of ${interview.answerCap} answers accepted.`}</p>
      {turnActive && <p>Answer processing: {currentTurn.checkpoint?.replaceAll('_', ' ') || currentTurn.status}. You can reload safely.</p>}
      {reply && speech?.status !== 'accepted' && <p>Saved reply speech: {speech?.status ?? 'unavailable'}.</p>}
    </div>
    {(state.loadError || state.subscriptionError) && <div className="grid gap-2"><p role="alert">Live updates are unavailable. Check saved status to recover the current state.</p><Button variant="outline" className="justify-self-start" disabled={state.busy} onClick={() => void state.checkSavedStatus()}>Check saved status</Button></div>}
    <SectionCard title="Accepted dialogue" tone="facts" sectionId={`interview:${id}:dialogue`}>
      <ol className="divide-y">
        {interview.messages.map((message) => <li key={message.id} className="grid gap-3 py-5 first:pt-0 last:pb-0">
          <p className="text-sm font-medium">{message.kind === 'answer' ? 'Scripted demo answer' : 'Interviewer'}</p>
          <p className="max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed">{message.content}</p>
          {message.kind !== 'answer' && operations.some((operation) => operation.messageId === message.id && operation.status === 'accepted') && <InterviewAudio interviewId={id} messageId={message.id} />}
        </li>)}
      </ol>
    </SectionCard>
    {reply && <div className="grid gap-3 border-t pt-5">
      <p className="max-w-prose whitespace-pre-wrap break-words leading-relaxed">{reply.content}</p>
      {speech?.status === 'accepted' && <InterviewAudio key={reply.id} interviewId={id} messageId={reply.id} />}
      {(speech?.status === 'failed' || speech?.status === 'expired') && <div className="grid gap-2"><p role="alert">Speech unavailable: {speech.failureCode?.replaceAll('_', ' ') || 'speech failed'}. Saved dialogue is unchanged.</p>{speech.canRetry ? <Button className="justify-self-start" variant="outline" disabled={state.busy} onClick={() => void state.retryOperation(speech.id)}>Retry speech</Button> : <p className="text-sm">This speech cannot be retried. Its audio may have expired or reached the recovery limit.</p>}</div>}
    </div>}
    {state.unresolved && <div className="grid gap-3 border-t pt-5"><p role="alert">The submission response was not confirmed. Check saved status or retry the same submission; this keeps the original answer identity.</p><div className="flex flex-wrap gap-3"><Button variant="outline" disabled={state.busy} onClick={() => void state.checkSavedStatus()}>Check saved status</Button><Button disabled={state.busy || state.loading || Boolean(state.loadError)} onClick={() => void state.checkSavedStatus(true)}>Retry same submission</Button></div></div>}
    {(currentTurn?.status === 'failed' || currentTurn?.status === 'expired') && <div className="grid gap-2"><p role="alert">Answer failed: {currentTurn.failureCode?.replaceAll('_', ' ') || 'execution failed'}. No answer allowance was used.</p>{currentTurn.canRetry ? <Button className="justify-self-start" variant="outline" disabled={state.busy} onClick={() => void state.retryOperation(currentTurn.id)}>Retry answer processing</Button> : <p className="text-sm">Record a new answer to continue.</p>}</div>}
    {interview.status === 'active' && <div className="grid gap-3 border-t pt-5">
      <p className="text-sm text-muted-foreground">Done answering stops the microphone so you can listen, submit, or re-record. Nothing is uploaded until you submit. Silence never submits.</p>
      <div className="flex flex-wrap gap-3">
        {recorder.status === 'recording' ? <Button onClick={recorder.stop}>Done answering</Button> : <Button disabled={!canRecord || recorder.status === 'requesting' || recorder.status === 'ready'} onClick={() => void recorder.start()}>{recorder.status === 'requesting' ? 'Requesting microphone…' : 'Record answer'}</Button>}
        {recorder.recording && <><Button disabled={!canRecord || savingRecording} onClick={() => void submit()}>Submit recording</Button><Button variant="outline" disabled={recordingLocked} onClick={recorder.reset}>Discard recording</Button><Button variant="outline" disabled={!canRecord || savingRecording} onClick={() => void recorder.start()}>Re-record</Button></>}
      </div>
      {recorder.recording && <RecordingReview recording={recorder.recording} />}
      {recorder.status === 'recording' && <p role="status">Recording… Stop within 2 minutes.</p>}
      {!canRecord && !turnActive && interview.status === 'active' && speech?.status !== 'accepted' && <p className="text-sm text-muted-foreground">Recording is available once the current reply's speech is ready. Listening first is optional.</p>}
      {recorder.error && <p role="alert" className="text-destructive">{recorder.error}</p>}
    </div>}
    {state.busy && <p role="status">Saving…</p>}
    {state.error && <p role="alert" className="text-destructive">{state.error}</p>}
  </>
}
