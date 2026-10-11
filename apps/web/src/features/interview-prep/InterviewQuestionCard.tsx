/**
 * Description: Persistent typed answer draft, explicit saving, feedback, and confirmed replacement.
 * Index: InterviewQuestionCard
 */
import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { SectionCard } from '@/components/SectionCard'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { INTERVIEW_ANSWER_TEXT } from '@/lib/textLimits'
import type { InterviewSetQuery } from '@/graphql/generated/graphql'
import { InterviewFeedback } from './InterviewFeedback'
import { InterviewTaskStatus } from './InterviewTaskStatus'
import { useInterviewAnswer } from './useInterviewAnswer'

type Question = InterviewSetQuery['interviewQuestionSet']['questions'][number]
/** Keeps drafts and subscriptions alive even when a question's section is collapsed. */
export function InterviewQuestionCard({ question, setId, refetch, onDirty }: { question: Question; setId: string; refetch: () => Promise<unknown>; onDirty: (id: string, dirty: boolean) => void }) {
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
  return <>
    {task && <InterviewTaskStatus key={task.id} task={task} onFinished={refetch} operation={task.taskType === 'REVIEW_INTERVIEW_ANSWER' ? 'feedback' : 'replacement'} />}
    <SectionCard tone="facts" title={`Question ${question.position}`} sectionId={`interview.${setId}.${question.id}`}>
      <p className="mb-4 whitespace-pre-wrap">{question.questionText}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid min-w-0 content-start gap-3">
          <label htmlFor={`answer-${question.id}`} className="font-medium">Your answer</label>
          <Textarea id={`answer-${question.id}`} value={answer} maxLength={INTERVIEW_ANSWER_TEXT} disabled={replacing || busy === 'replace'} onChange={(event) => { setEdits((count) => count + 1); setAnswer(event.target.value) }} className="min-h-48" />
          <p className="text-sm text-muted-foreground" role="status">{busy === 'save' ? 'Saving answer…' : dirty ? 'Unsaved changes' : 'Answer saved'} · {answer.length.toLocaleString()} / {INTERVIEW_ANSWER_TEXT.toLocaleString()}</p>
          <ErrorAlert title="Couldn't complete this action" messages={errors} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!!busy || replacing || !dirty} onClick={() => void perform('save')}>Save answer</Button>
            <Button disabled={!!busy || replacing || reviewing || feedbackForVersion || dirty || !answer.trim() || answer.length > INTERVIEW_ANSWER_TEXT} onClick={() => void perform('feedback')}>
              {(busy === 'feedback' || reviewing) && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
              {busy === 'feedback' ? 'Requesting feedback…' : reviewing ? 'Reviewing answer…' : 'Get feedback'}
            </Button>
            <Button variant="outline" disabled={!!busy || replacing || reviewing} onClick={() => { if (answer.trim() || question.answerText.trim()) setConfirmOpen(true); else void perform('replace') }}>Regenerate question</Button>
          </div>
          {(busy === 'feedback' || reviewing) && <p role="status" className="text-sm text-muted-foreground">{busy === 'feedback' ? 'Sending your answer for feedback…' : 'Feedback is being prepared. You can keep editing your answer.'}</p>}
          {dirty && <p className="text-sm text-muted-foreground">Save your answer before requesting feedback.</p>}
          {feedbackForVersion && !dirty && <p className="text-sm text-muted-foreground">Feedback received for this version. Save a changed answer to request feedback again.</p>}
        </div>
        <InterviewFeedback feedback={question.feedback} outdated={question.feedbackOutdated || feedbackDraftChanged} unsavedChanges={feedbackDraftChanged} />
      </div>
    </SectionCard>
    <Dialog open={confirmOpen} onOpenChange={(open) => { if (!busy) setConfirmOpen(open) }}><DialogContent><DialogHeader><DialogTitle>Replace this answered question?</DialogTitle><DialogDescription>Successful replacement clears this answer and its feedback. Your current question stays available if replacement fails.</DialogDescription></DialogHeader><ErrorAlert title="Couldn't replace question" messages={errors} /><DialogFooter><DialogClose asChild><Button variant="outline" disabled={!!busy}>Cancel</Button></DialogClose><Button disabled={!!busy} onClick={() => void perform('replace')}>Replace question</Button></DialogFooter></DialogContent></Dialog>
  </>
}
