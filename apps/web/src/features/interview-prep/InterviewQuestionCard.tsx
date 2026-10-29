/**
 * Description: One practice question: write and save an answer, get coaching, or replace the question.
 * Get feedback saves the typed answer first. Replacing an answered question keeps the old answer
 * as a read-only copy on the practice page. "Don't show this again" only affects future questions.
 */
import { useEffect, useState } from 'react'
import { Ellipsis, LoaderCircle } from 'lucide-react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { INTERVIEW_ANSWER_TEXT } from '@/lib/textLimits'
import type { InterviewSetQuery } from '@/graphql/generated/graphql'
import { InterviewFeedback } from './InterviewFeedback'
import { InterviewTaskStatus } from './InterviewTaskStatus'
import { useInterviewAnswer } from './useInterviewAnswer'
import { useQuestionAvoidance } from './useQuestionAvoidance'

type Question = InterviewSetQuery['interviewQuestionSet']['questions'][number]
/** Keeps drafts and subscriptions alive while another question in the set is open. */
export function InterviewQuestionCard({ question, number, total, setId, refetch, onDirty }: { question: Question; number: number; total: number; setId: string; refetch: () => Promise<unknown>; onDirty: (id: string, dirty: boolean) => void }) {
  const avoidance = useQuestionAvoidance(setId, question.id, question.questionRevision, question.avoided)
  const [edits, setEdits] = useState(0)
  const [submittedEdits, setSubmittedEdits] = useState<number | null>(null)
  const [answer, setAnswer] = useState(question.answerText)
  const [baseline, setBaseline] = useState(question.answerText)
  const [serverAnswer, setServerAnswer] = useState(question.answerText)
  const [revision, setRevision] = useState(question.questionRevision)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [task, setTask] = useState(question.latestTask)
  const [observedTask, setObservedTask] = useState(question.latestTask)
  const { run, busy, errors } = useInterviewAnswer(setId, question.id)
  const [replacementRevision, setReplacementRevision] = useState(question.latestTask?.status === 'QUEUED' && question.latestTask.taskType === 'REGENERATE_INTERVIEW_QUESTION' ? question.questionRevision : null)
  const dirty = answer !== baseline
  const feedbackDraftChanged = answer.trim().replace(/\s+/g, ' ').toLowerCase() !== baseline.trim().replace(/\s+/g, ' ').toLowerCase()
  const replacing = replacementRevision !== null && task?.taskType === 'REGENERATE_INTERVIEW_QUESTION' && task.status !== 'FAILED' && question.questionRevision === replacementRevision
  const reviewing = task?.status === 'QUEUED' && task.taskType === 'REVIEW_INTERVIEW_ANSWER'
  const feedbackForVersion = question.feedbackQuestionRevision === question.questionRevision && question.feedbackAnswerRevision === question.answerRevision
  useEffect(() => { onDirty(question.id, dirty) }, [question.id, dirty, onDirty])
  // Reconcile external saved revisions without replacing a locally edited draft.
  if (question.questionRevision !== revision) {
    setRevision(question.questionRevision)
    setAnswer(question.answerText)
    setBaseline(question.answerText)
    setServerAnswer(question.answerText)
  } else if (question.answerText !== serverAnswer) {
    if (answer === baseline && (submittedEdits === null || submittedEdits === edits)) setAnswer(question.answerText)
    setSubmittedEdits(null)
    setBaseline(question.answerText)
    setServerAnswer(question.answerText)
  }
  if (question.latestTask?.id !== observedTask?.id || question.latestTask?.status !== observedTask?.status) {
    setObservedTask(question.latestTask)
    setTask(question.latestTask)
    if (question.latestTask?.status === 'QUEUED' && question.latestTask.taskType === 'REGENERATE_INTERVIEW_QUESTION') setReplacementRevision(question.questionRevision)
  }
  /** Preserves edits made during a request and refreshes answers saved before queue errors. */
  async function perform(operation: 'save' | 'feedback' | 'replace') {
    const submitted = answer
    setSubmittedEdits(edits)
    const result = await run(operation, submitted)
    if (result.ok && operation !== 'replace') setBaseline(submitted)
    if (result.task) {
      setTask(result.task)
      if (operation === 'replace') setReplacementRevision(question.questionRevision)
    }
    if (result.ok && operation === 'replace') setConfirmOpen(false)
    try { await refetch() } catch { /* The page query exposes refresh errors and keeps the draft available. */ }
  }
  const canRequestFeedback = !busy && !replacing && !reviewing && !(feedbackForVersion && !feedbackDraftChanged) &&
    answer.trim() !== '' && answer.length <= INTERVIEW_ANSWER_TEXT
  const saveStatus = busy === 'save' ? 'Saving…' : busy === 'feedback' ? 'Saving and sending for feedback…'
    : reviewing ? 'Getting feedback. You can keep editing.' : dirty ? 'Unsaved changes' : 'Saved'
  return <article className="question-card" aria-labelledby={`question-${question.id}`}>
    {task && <InterviewTaskStatus key={task.id} task={task} onFinished={refetch} operation={task.taskType === 'REVIEW_INTERVIEW_ANSWER' ? 'feedback' : 'replacement'} />}
    <header className="question-card-header">
      <p className="question-card-kicker">Question {number} of {total}</p>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for question ${number}`}><Ellipsis /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!!busy || replacing || reviewing} onSelect={() => { if (answer.trim() || question.answerText.trim()) setConfirmOpen(true); else void perform('replace') }}>Replace question</DropdownMenuItem>
          <DropdownMenuItem disabled={avoidance.saved || avoidance.saving || replacing || busy === 'replace'} onSelect={() => void avoidance.save()}>
            {avoidance.saved ? 'Hidden from new questions' : "Don't show this again"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
    <h2 id={`question-${question.id}`} className="question-card-title">{question.questionText}</h2>
    {(avoidance.saved || avoidance.saving) && <p role="status" className="text-sm text-muted-foreground">{avoidance.saving ? 'Saving preference…' : "Saved. New questions won't repeat this one."}</p>}
    <ErrorAlert title="Couldn't save preference" messages={avoidance.errors} />
    <div className="question-card-body">
      <div className="grid min-w-0 content-start gap-3">
        <label htmlFor={`answer-${question.id}`} className="font-bold">Your answer</label>
        <Textarea id={`answer-${question.id}`} value={answer} maxLength={INTERVIEW_ANSWER_TEXT} disabled={replacing || busy === 'replace'} onChange={(event) => { setEdits((count) => count + 1); setAnswer(event.target.value) }} className="min-h-64" />
        <div className="question-answer-status">
          <p role="status">{saveStatus}</p>
          <p>{answer.length.toLocaleString()} / {INTERVIEW_ANSWER_TEXT.toLocaleString()}</p>
        </div>
        <ErrorAlert title="Couldn't complete this action" messages={errors} />
        <div className="flex flex-wrap gap-2">
          <Button disabled={!canRequestFeedback} onClick={() => void perform('feedback')}>
            {(busy === 'feedback' || reviewing) && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
            {busy === 'feedback' ? 'Sending…' : reviewing ? 'Getting feedback…' : 'Get feedback'}
          </Button>
          <Button variant="outline" disabled={!!busy || replacing || !dirty} onClick={() => void perform('save')}>Save</Button>
        </div>
        {feedbackForVersion && !feedbackDraftChanged && !reviewing && <p className="text-sm text-muted-foreground">This feedback is for your current answer. Change your answer to get new feedback.</p>}
      </div>
      <InterviewFeedback feedback={question.feedback} outdated={question.feedbackOutdated || feedbackDraftChanged} unsavedChanges={feedbackDraftChanged} />
    </div>
    <Dialog open={confirmOpen} onOpenChange={(open) => { if (!busy) setConfirmOpen(open) }}><DialogContent><DialogHeader><DialogTitle>Replace this question?</DialogTitle><DialogDescription>Your saved answer and its feedback are kept under “Answers from replaced questions” on the practice page.{dirty ? ' Unsaved changes will be lost.' : ''} If replacement fails, nothing changes.</DialogDescription></DialogHeader><ErrorAlert title="Couldn't replace question" messages={errors} /><DialogFooter><DialogClose asChild><Button variant="outline" disabled={!!busy}>Cancel</Button></DialogClose><Button disabled={!!busy} onClick={() => void perform('replace')}>Replace question</Button></DialogFooter></DialogContent></Dialog>
  </article>
}
