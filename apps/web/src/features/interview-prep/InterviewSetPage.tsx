/**
 * Description: A single practice question with its saved answer and feedback.
 * The URL names the open question; without one, the page opens the first unanswered question.
 * Internal batch IDs keep existing links working; leaving an unsaved answer asks first.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useBlocker, useBeforeUnload } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { PageHeading } from '@/components/PageHeading'
import { Button } from '@/components/ui/button'
import { InterviewQuestionCard } from './InterviewQuestionCard'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { DismissQuestionGenerationButton } from './DismissQuestionGenerationButton'
import { InterviewTaskStatus } from './InterviewTaskStatus'
import { interviewSetDate } from './interviewSetDate'
import { interviewSetTypeLabel } from './interviewSetTypeLabel'
import { useInterviewSet } from './useInterviewPrep'

/** Restores generation after reload, then opens a question without batch navigation. */
export function InterviewSetPage() {
  const { id = '', questionId } = useParams()
  const { questionSet, loading, error, refetch } = useInterviewSet(id)
  const navigate = useNavigate()
  const [dirtyAnswers, setDirtyAnswers] = useState<Record<string, boolean>>({})
  const questions = questionSet?.questions.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0)) ?? []
  const active = questions.find((question) => question.id === questionId) ?? questions[0]
  const dirty = Boolean(active && dirtyAnswers[active.id])
  const setPath = `/practice/questions/${id}`
  const blocker = useBlocker(({ nextLocation }) => dirty && nextLocation.pathname !== `${setPath}/${active?.id}`)
  const onDirty = useCallback((changedId: string, value: boolean) => setDirtyAnswers((current) => ({ ...current, [changedId]: value })), [])
  useBeforeUnload(useCallback((event) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }, [dirty]))
  const defaultId = (questions.find((question) => !question.answerText.trim()) ?? questions[0])?.id
  const urlNamesQuestion = questions.some((question) => question.id === questionId)
  // Pin the default question in the URL once, so saving an answer never moves the open question.
  useEffect(() => {
    if (defaultId && !urlNamesQuestion) void navigate(`${setPath}/${defaultId}`, { replace: true })
  }, [defaultId, urlNamesQuestion, navigate, setPath])
  const result: unknown = questionSet?.latestTask?.result
  const warnings = result && typeof result === 'object' && 'warnings' in result && Array.isArray(result.warnings)
    ? result.warnings.filter((warning): warning is string => typeof warning === 'string') : []

  return <div className="question-set-page">
    <Link className="question-back-link" to="/practice/questions"><ArrowLeft aria-hidden="true" />All questions</Link>
    {blocker.state === 'blocked' && <div role="alert" className="grid gap-3 rounded-md border p-4"><p>You have unsaved answers. Leave and discard your changes?</p><div className="flex gap-2"><Button onClick={() => blocker.reset()}>Keep editing</Button><Button variant="outline" onClick={() => blocker.proceed()}>Leave page</Button></div></div>}
    {error && <ErrorAlert title="Couldn't load this question" messages={[requestErrorMessage(error, error.message)]} />}
    {!questionSet && loading && <p>Loading…</p>}
    {questionSet && <>
      <PageHeading title={active ? 'Practice question' : 'Practice questions'} description={`${interviewSetTypeLabel(questionSet.setType)} · ${interviewSetDate(questionSet.createdAt)}`}
        actions={questions.length === 0 && <DismissQuestionGenerationButton id={id} onDeleted={() => void navigate('/practice/questions')} />} />
      {questionSet.latestTask && <InterviewTaskStatus key={questionSet.latestTask.id} task={questionSet.latestTask} onFinished={refetch} />}
      {warnings.length > 0 && <div className="grid gap-1 text-sm text-muted-foreground"><p>Some library notes were omitted:</p><ul className="list-disc pl-5">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
      {active && <InterviewQuestionCard key={active.id} question={active} setId={id} refetch={refetch} onDirty={onDirty} />}
    </>}
  </div>
}
