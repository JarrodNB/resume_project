/** Shows saved preparation progress and the selected job or fictional role before entry.
 * While questions are prepared, a waiting line shows the work is moving; its captions
 * describe the steps but do not track them. Private career sources and executor history
 * stay on the server.
 */
import type { InterviewSnapshotFragment } from '@/graphql/generated/graphql'
import { difficultyOptions, focusOptions, interviewerOptions, typeOptions } from './interviewSetupOptions'
import { AiWaitingLine } from '@/components/AiWaitingLine'
import { Button } from '@/components/ui/button'
import { InterviewJobContext } from './InterviewJobContext'
import { InterviewJobSource } from './InterviewJobSource'
import { Link } from 'react-router'

interface Props {
  interview: InterviewSnapshotFragment
  busy: boolean
  error: string | null
  disconnected: boolean
  retry: (id: string) => Promise<void>
  refresh: () => Promise<void>
  begin: () => Promise<void>
}

function roleData(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.title !== 'string' || !Array.isArray(record.responsibilities) || !Array.isArray(record.requirements)) return null
  return { title: record.title, responsibilities: record.responsibilities.filter((item): item is string => typeof item === 'string'), requirements: record.requirements.filter((item): item is string => typeof item === 'string') }
}

/** Visible captions for the waiting line; they describe the work, not tracked progress. */
function preparationCaptions(running: boolean, savedJob: boolean, questionCount: number) {
  if (!running) return ['Waiting to start', 'Still in line. Preparation starts shortly']
  return [
    ...(savedJob ? ['Reading the job', 'Looking through your career library', 'Matching your experience to the role'] : ['Looking through your career library', 'Imagining a role that fits your background', 'Writing the role requirements']),
    `Drafting ${questionCount} core questions`,
    'Checking each question',
    'Still working on it. A full interview can take a minute',
  ]
}

export function InterviewPreparation({ interview, busy, error, disconnected, retry, refresh, begin }: Props) {
  const operation = interview.operations.find((item) => item.kind === 'preparation')
  const role = roleData(interview.preparedRole)
  const job = interview.jobContext
  const followUpLimit = Math.max(0, interview.answerCap - 1)
  return <div className="grid gap-5">
    {job && interview.status !== 'ready' && <InterviewJobSource job={job} />}
    {job && interview.status === 'ready' && job.id && <Link className="justify-self-start text-sm underline underline-offset-4" to={`/jobs/${job.id}`}>Back to job</Link>}
    {job && interview.status === 'ready' && !job.id && <p className="text-sm text-muted-foreground">The original job was deleted. Your prepared questions remain available.</p>}
    {interview.status === 'ready' ? <>
      <div className="grid gap-2">
        <h2 className="text-xl font-medium">{job ? 'Review your saved job' : role ? 'Review your fictional role' : 'Review your prepared interview'}</h2>
        <p className="max-w-prose text-sm text-muted-foreground">{job ? 'Questions were prepared using your career library and this job. Job details shown here reflect the current saved job.' : role ? 'This role was prepared from your career library. It is an imagined vacancy; its requirements are not claims about your experience.' : 'Your prepared questions are ready. The original job is no longer available.'}</p>
      </div>
      {job ? <InterviewJobContext job={job} sectionId={`interview.${interview.id}.job-details`} /> : role && <div className="grid gap-5 border-y py-5">
        <h3 className="text-lg font-medium break-words">{role.title}</h3>
        <div className="grid gap-2"><h4 className="font-medium">Responsibilities</h4><ul className="list-disc space-y-2 pl-5 text-sm">{role.responsibilities.map((item, index) => <li className="break-words" key={index}>{item}</li>)}</ul></div>
        <div className="grid gap-2"><h4 className="font-medium">Role requirements</h4><ul className="list-disc space-y-2 pl-5 text-sm">{role.requirements.map((item, index) => <li className="break-words" key={index}>{item}</li>)}</ul></div>
      </div>}
      <p className="text-sm text-muted-foreground">{typeOptions.find((item) => item.value === interview.setup.questionFormat)?.label} · {difficultyOptions.find((item) => item.value === interview.setup.difficulty)?.label} · {interviewerOptions.find((item) => item.value === interview.setup.interviewer)?.label}</p>
      <p className="text-sm text-muted-foreground">Focus areas: {interview.setup.focusAreas.length ? interview.setup.focusAreas.map((area) => focusOptions[area] ?? area).join(', ') : 'Balanced round'}</p>
      <p role="status" className="text-sm">Your {interview.questions.length} core questions are prepared. Your interview is ready.</p>
      <p className="text-sm text-muted-foreground">Enter the room to hear your first question. Each core question may be followed by up to {followUpLimit} related {followUpLimit === 1 ? 'question' : 'questions'}; the interviewer may move on sooner.</p>
      <Button className="min-h-11 justify-self-start" disabled={busy} onClick={() => void begin()}>{busy ? 'Entering…' : 'Enter interview room'}</Button>
    </> : <>
      <h2 className="text-xl font-medium">Preparing your interview</h2>
      <p className="max-w-prose text-sm">{job ? `We are preparing ${interview.setup.questionCount} core questions for ${job.title} using your saved career details.` : `We are preparing a fictional role and ${interview.setup.questionCount} core questions from your saved career details.`} Progress is saved; you can reload safely.</p>
      {(operation?.status === 'failed' || operation?.status === 'expired') ? <div className="grid gap-3">
        <p role="alert">Preparation unavailable: {operation.failureCode?.replaceAll('_', ' ') || 'preparation failed'}.</p>
        {operation.canRetry ? <Button className="justify-self-start" variant="outline" disabled={busy} onClick={() => void retry(operation.id)}>Retry preparation</Button> : <p className="text-sm">This preparation cannot be retried. Check your career details before preparing a new interview.</p>}
      </div> : <AiWaitingLine key={operation?.status === 'running' ? 'running' : 'waiting'} captions={preparationCaptions(operation?.status === 'running', Boolean(job), interview.setup.questionCount)} statusLabel="Preparing your interview…" captionSeconds={4} />}
    </>}
    {disconnected && <div className="grid gap-2"><p role="alert">Live updates are unavailable.</p><Button className="justify-self-start" variant="outline" disabled={busy} onClick={() => void refresh()}>Check saved status</Button></div>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>
}
