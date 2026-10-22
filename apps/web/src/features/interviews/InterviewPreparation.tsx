/** Shows saved preparation progress and the fictional role before the spoken interview begins.
 * Private career sources and executor history stay on the server.
 */
import type { InterviewSnapshotFragment } from '@/graphql/generated/graphql'
import { difficultyOptions, focusOptions, interviewerOptions, typeOptions } from './interviewSetupOptions'
import { Button } from '@/components/ui/button'

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

export function InterviewPreparation({ interview, busy, error, disconnected, retry, refresh, begin }: Props) {
  const operation = interview.operations.find((item) => item.kind === 'preparation')
  const role = roleData(interview.preparedRole)
  return <div className="grid gap-5">
    {interview.status === 'ready' && role ? <>
      <div className="grid gap-2">
        <h2 className="text-xl font-medium">Review your fictional role</h2>
        <p className="max-w-prose text-sm text-muted-foreground">This role was prepared from your career library. It is an imagined vacancy; its requirements are not claims about your experience. Later library edits will not change this interview.</p>
      </div>
      <div className="grid gap-5 border-y py-5">
        <h3 className="text-lg font-medium break-words">{role.title}</h3>
        <div className="grid gap-2"><h4 className="font-medium">Responsibilities</h4><ul className="list-disc space-y-2 pl-5 text-sm">{role.responsibilities.map((item, index) => <li className="break-words" key={index}>{item}</li>)}</ul></div>
        <div className="grid gap-2"><h4 className="font-medium">Role requirements</h4><ul className="list-disc space-y-2 pl-5 text-sm">{role.requirements.map((item, index) => <li className="break-words" key={index}>{item}</li>)}</ul></div>
      </div>
      <p className="text-sm text-muted-foreground">{typeOptions.find((item) => item.value === interview.setup.questionFormat)?.label} · {difficultyOptions.find((item) => item.value === interview.setup.difficulty)?.label} · {interviewerOptions.find((item) => item.value === interview.setup.interviewer)?.label}</p>
      <p className="text-sm text-muted-foreground">Focus areas: {interview.setup.focusAreas.length ? interview.setup.focusAreas.map((area) => focusOptions[area] ?? area).join(', ') : 'Balanced round'}</p>
      <p role="status" className="text-sm">Your {interview.questions.length} questions are prepared. Your interview is ready.</p>
      <p className="text-sm text-muted-foreground">Enter the room to hear your first question. Each question allows up to {interview.answerCap} saved responses; the interviewer may move on sooner.</p>
      <Button className="min-h-11 justify-self-start" disabled={busy} onClick={() => void begin()}>{busy ? 'Entering…' : 'Enter interview room'}</Button>
    </> : <>
      <h2 className="text-xl font-medium">Preparing your interview</h2>
      <p className="max-w-prose text-sm">We are preparing a fictional role and {interview.setup.questionCount} main questions from your saved career details. Progress is saved; you can reload safely.</p>
      {(operation?.status === 'failed' || operation?.status === 'expired') ? <div className="grid gap-3">
        <p role="alert">Preparation unavailable: {operation.failureCode?.replaceAll('_', ' ') || 'preparation failed'}.</p>
        {operation.canRetry ? <Button className="justify-self-start" variant="outline" disabled={busy} onClick={() => void retry(operation.id)}>Retry preparation</Button> : <p className="text-sm">This preparation cannot be retried. Check your career details before preparing a new interview.</p>}
      </div> : <p role="status" className="text-sm text-muted-foreground">{operation?.checkpoint?.replaceAll('_', ' ') || operation?.status || 'Waiting for saved progress'}…</p>}
    </>}
    {disconnected && <div className="grid gap-2"><p role="alert">Live updates are unavailable.</p><Button className="justify-self-start" variant="outline" disabled={busy} onClick={() => void refresh()}>Check saved status</Button></div>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>
}
