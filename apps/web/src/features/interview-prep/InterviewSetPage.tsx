/**
 * Description: One persistent interview set with five ordered, collapsible question cards.
 * Index: InterviewSetPage
 */
import { useCallback, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link, useNavigate, useParams, useBlocker, useBeforeUnload } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { InterviewQuestionCard } from './InterviewQuestionCard'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { DeleteInterviewSetButton } from './DeleteInterviewSetButton'
import { InterviewTaskStatus } from './InterviewTaskStatus'
import { interviewSetDate } from './interviewSetDate'
import { interviewSetTypeLabel } from './interviewSetTypeLabel'
import { useInterviewSet } from './useInterviewPrep'

/** Restores generation after reload and displays the saved questions after completion. */
export function InterviewSetPage() {
  const { id = '' } = useParams()
  const { questionSet, loading, error, refetch } = useInterviewSet(id)
  const navigate = useNavigate()
  const [dirtyAnswers, setDirtyAnswers] = useState<Record<string, boolean>>({})
  const dirty = questionSet?.questions.some((question) => dirtyAnswers[question.id]) ?? false
  const blocker = useBlocker(dirty)
  const onDirty = useCallback((questionId: string, value: boolean) => setDirtyAnswers((current) => ({ ...current, [questionId]: value })), [])
  useBeforeUnload(useCallback((event) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }, [dirty]))
  const result: unknown = questionSet?.latestTask?.result
  const warnings = result && typeof result === 'object' && 'warnings' in result && Array.isArray(result.warnings)
    ? result.warnings.filter((warning): warning is string => typeof warning === 'string') : []
  return <div className="mx-auto grid max-w-6xl gap-6">
    <Link className="text-sm underline underline-offset-4" to="/interview-prep">All question sets</Link>
    {blocker.state === 'blocked' && <div role="alert" className="grid gap-3 rounded-md border p-4"><p>You have unsaved answers. Leave and discard your changes?</p><div className="flex gap-2"><Button onClick={() => blocker.reset()}>Keep editing</Button><Button variant="outline" onClick={() => blocker.proceed()}>Leave page</Button></div></div>}
    {error && <ErrorAlert title="Couldn't load this set" messages={[requestErrorMessage(error, error.message)]} />}
    {!questionSet && loading && <p>Loading…</p>}
    {questionSet && <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Set {questionSet.number} · {interviewSetTypeLabel(questionSet.setType)} · {interviewSetDate(questionSet.createdAt)}</h1>
        <DeleteInterviewSetButton id={id} number={questionSet.number} onDeleted={() => { flushSync(() => setDirtyAnswers({})); navigate('/interview-prep') }} />
      </div>
      {questionSet.latestTask && <InterviewTaskStatus key={questionSet.latestTask.id} task={questionSet.latestTask} onFinished={refetch} />}
      {warnings.length > 0 && <div className="grid gap-1 text-sm text-muted-foreground"><p>Some library notes were omitted:</p><ul className="list-disc pl-5">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
      {questionSet.questions.slice().sort((a, b) => a.position - b.position).map((question) => <InterviewQuestionCard key={question.id} question={question} setId={id} refetch={refetch} onDirty={onDirty} />)}
    </>}
  </div>
}
