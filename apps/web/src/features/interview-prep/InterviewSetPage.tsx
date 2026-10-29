/**
 * Description: One set of five practice questions, worked one question at a time.
 * The URL names the open question; without one, the page opens the first unanswered question.
 * All five cards stay mounted (only the open one shows), so drafts and live task updates survive
 * moving between questions. Leaving the set with unsaved answers asks first.
 */
import { useCallback, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link, useNavigate, useParams, useBlocker, useBeforeUnload } from 'react-router'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { PageHeading } from '@/components/PageHeading'
import { Button } from '@/components/ui/button'
import { InterviewQuestionCard } from './InterviewQuestionCard'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { DeleteInterviewSetButton } from './DeleteInterviewSetButton'
import { InterviewTaskStatus } from './InterviewTaskStatus'
import { interviewSetDate } from './interviewSetDate'
import { interviewSetTypeLabel } from './interviewSetTypeLabel'
import { QuestionLine } from './QuestionLine'
import { useInterviewSet } from './useInterviewPrep'

/** Restores generation after reload, then shows the open question with links to the others. */
export function InterviewSetPage() {
  const { id = '', questionId } = useParams()
  const { questionSet, loading, error, refetch } = useInterviewSet(id)
  const navigate = useNavigate()
  const [dirtyAnswers, setDirtyAnswers] = useState<Record<string, boolean>>({})
  const questions = questionSet?.questions.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0)) ?? []
  const dirty = questionSet?.questions.some((question) => dirtyAnswers[question.id]) ?? false
  const setPath = `/practice/questions/${id}`
  // Moving between this set's questions keeps every draft, so only leaving the set is blocked.
  const blocker = useBlocker(({ nextLocation }) => dirty && nextLocation.pathname !== setPath && !nextLocation.pathname.startsWith(`${setPath}/`))
  const onDirty = useCallback((changedId: string, value: boolean) => setDirtyAnswers((current) => ({ ...current, [changedId]: value })), [])
  useBeforeUnload(useCallback((event) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }, [dirty]))
  const activeIndex = Math.max(0, questions.findIndex((question) => question.id === questionId))
  const active = questions[activeIndex]
  const defaultId = (questions.find((question) => !question.answerText.trim()) ?? questions[0])?.id
  const urlNamesQuestion = questions.some((question) => question.id === questionId)
  // Pin the default question in the URL once, so saving an answer never moves the open question.
  useEffect(() => {
    if (defaultId && !urlNamesQuestion) void navigate(`${setPath}/${defaultId}`, { replace: true })
  }, [defaultId, urlNamesQuestion, navigate, setPath])
  const result: unknown = questionSet?.latestTask?.result
  const warnings = result && typeof result === 'object' && 'warnings' in result && Array.isArray(result.warnings)
    ? result.warnings.filter((warning): warning is string => typeof warning === 'string') : []
  const previous = questions[activeIndex - 1]
  const next = questions[activeIndex + 1]

  return <div className="question-set-page">
    <Link className="question-back-link" to="/practice/questions"><ArrowLeft aria-hidden="true" />All questions</Link>
    {blocker.state === 'blocked' && <div role="alert" className="grid gap-3 rounded-md border p-4"><p>You have unsaved answers. Leave and discard your changes?</p><div className="flex gap-2"><Button onClick={() => blocker.reset()}>Keep editing</Button><Button variant="outline" onClick={() => blocker.proceed()}>Leave page</Button></div></div>}
    {error && <ErrorAlert title="Couldn't load this set" messages={[requestErrorMessage(error, error.message)]} />}
    {!questionSet && loading && <p>Loading…</p>}
    {questionSet && <>
      <PageHeading title={`Set ${questionSet.number}`} description={`${interviewSetTypeLabel(questionSet.setType)} questions · ${interviewSetDate(questionSet.createdAt)}`}
        actions={<DeleteInterviewSetButton id={id} number={questionSet.number} onDeleted={() => { flushSync(() => setDirtyAnswers({})); void navigate('/practice/questions') }} />} />
      {questionSet.latestTask && <InterviewTaskStatus key={questionSet.latestTask.id} task={questionSet.latestTask} onFinished={refetch} />}
      {warnings.length > 0 && <div className="grid gap-1 text-sm text-muted-foreground"><p>Some library notes were omitted:</p><ul className="list-disc pl-5">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
      {questions.length > 0 && active && <>
        <QuestionLine setId={id} questions={questions} activeId={active.id} />
        {questions.map((question, index) => <div key={question.id} hidden={question.id !== active.id}>
          <InterviewQuestionCard question={question} number={index + 1} total={questions.length} setId={id} refetch={refetch} onDirty={onDirty} />
        </div>)}
        <div className="question-step-links">
          {previous ? <Link to={`${setPath}/${previous.id}`}><ArrowLeft aria-hidden="true" />Question {activeIndex}</Link> : <span />}
          {next && <Link to={`${setPath}/${next.id}`}>Question {activeIndex + 2}<ArrowRight aria-hidden="true" /></Link>}
        </div>
      </>}
    </>}
  </div>
}
