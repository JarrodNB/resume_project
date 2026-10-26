/** Opens a focused editing workspace beside one career detail.
 * Review questions can generate a proposal directly; ordinary edits retain feedback turns.
 * Review a proposal beside its saved source and save when ready.
 * Closing preserves the draft; discarding removes it through the existing edit service.
 */
import { useId, useState } from 'react'
import { Check, CheckCheck, LoaderCircle } from 'lucide-react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PROSE_TEXT } from '@/lib/textLimits'
import { LibraryAssessment } from './LibraryAssessment'
import { useLibraryEdit } from './useLibraryEdit'
import { ReviewAnswerForm } from './ReviewAnswerForm'

interface Props {
  kind: string
  recordId: string
  sourceRevision: string
  disabled?: boolean
  reviewQuestion?: { reviewTaskId: string; question?: string; questions?: string[]; stale: boolean }
  onClose: () => void
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function LibraryEditPanel({ kind, recordId, sourceRevision, disabled = false, reviewQuestion, onClose }: Props) {
  const edit = useLibraryEdit(kind, recordId, sourceRevision)
  const [feedback, setFeedback] = useState('')
  const [startingAnother, setStartingAnother] = useState(false)
  const feedbackId = useId()
  const helpId = useId()
  const task = startingAnother && edit.task?.acceptedAt ? undefined : edit.task
  const stale = !startingAnother && edit.stale
  const proposal = object(task?.result)
  const questions = Array.isArray(task?.pendingQuestions) ? task.pendingQuestions : []
  const question = object(questions[0]).question
  const accepted = !!task?.acceptedAt
  const hasProposal = task?.status === 'COMPLETED' && typeof proposal.text === 'string'
  const origin = object(object(task?.input).review_question)
  const reviewQuestions = reviewQuestion?.questions ?? (reviewQuestion?.question ? [reviewQuestion.question] : [])
  const showAnswerForm = !!reviewQuestion && reviewQuestions.length > 0 && origin.review_task_id !== reviewQuestion.reviewTaskId
  const label = typeof question === 'string' ? 'Your answer' : task ? 'What should change?' : 'What would you like to improve? (optional)'

  async function submit(skip = false, fresh = false) {
    if (await edit.submit(skip ? '' : feedback, skip, fresh || startingAnother)) {
      setFeedback('')
      setStartingAnother(false)
    }
  }

  return <section aria-label="Improve this career detail" className="library-edit-panel grid gap-5 text-sm">
    <ErrorAlert title="Could not complete this edit" messages={edit.errors} />
    {!edit.loading && showAnswerForm && reviewQuestion && <ReviewAnswerForm key={reviewQuestion.reviewTaskId} questions={reviewQuestions} stale={reviewQuestion.stale} disabled={edit.busy || disabled} onSubmit={(answers) => edit.answerReview(reviewQuestion.reviewTaskId, answers)} />}
    {edit.loading ? <p className="text-muted-foreground" role="status">Loading saved edit…</p> : showAnswerForm && !task ? null : accepted ?
      <><p role="status" className="flex items-center gap-2 font-medium text-primary"><CheckCheck aria-hidden="true" className="size-4" />Saved to your library.</p><Button size="sm" variant="outline" className="w-full" onClick={() => setStartingAnother(true)}>Start another edit</Button></> : <>
      {stale && <p role="status" className="border-y py-3 font-medium">This draft is based on an earlier version of your entry. Generate a new revision using your latest changes.</p>}
      {task?.status === 'QUEUED' && <p role="status" className="flex items-center gap-2 py-2 text-muted-foreground"><LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin" />Working on this detail…</p>}
      {hasProposal && <div className="grid gap-4">
        <div className="min-w-0 border-y py-5"><h4 className="mb-2 text-sm font-semibold text-primary">Proposed revision</h4><p className="max-w-prose whitespace-pre-wrap leading-relaxed">{String(proposal.text)}</p></div>
        <LibraryAssessment assessment={{ kind, recordId, field: '', color: String(proposal.color), reason: String(proposal.reason), stale }} />
        <Button className="w-full" size="sm" disabled={edit.busy || stale || disabled} onClick={() => void edit.save()}><Check aria-hidden="true" />Accept revision</Button>
      </div>}
      {typeof question === 'string' && !stale && <div className="grid gap-1 border-t pt-4"><h4 className="font-medium text-primary">A little more context</h4><p className="leading-relaxed">{question}</p></div>}
      <form className="grid gap-3 border-t pt-4" onSubmit={(event) => { event.preventDefault(); void submit(false, stale) }}>
        <Label htmlFor={feedbackId}>{label}</Label>
        <Textarea id={feedbackId} aria-describedby={helpId} className="min-h-24 bg-card text-base md:text-sm" value={feedback} onChange={(event) => setFeedback(event.target.value)} maxLength={PROSE_TEXT} disabled={edit.busy || disabled} rows={3} />
        <p id={helpId} className="text-xs leading-relaxed text-muted-foreground">{typeof question === 'string' ? 'Answer in your own words, or skip if you’re unsure.' : 'For example, focus on your contribution or add an outcome you can support.'}</p>
        <div className="grid gap-2">
          <Button className="w-full" size="sm" variant={hasProposal && !stale ? 'outline' : 'default'} type="submit" disabled={edit.busy || disabled || (!!task && !stale && !feedback.trim())}>
            {stale ? 'Generate new revision' : task?.status === 'NEEDS_USER_INPUT' ? 'Send answer' : task ? 'Revise again' : 'Generate revision'}
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {task?.status === 'FAILED' && typeof origin.review_task_id === 'string' && !stale && <Button size="sm" type="button" variant="outline" disabled={edit.busy || disabled} onClick={() => void edit.submit(String(object(task.input).feedback ?? ''))}>Retry revision</Button>}
            {task?.status === 'NEEDS_USER_INPUT' && !stale && <Button size="sm" type="button" variant="outline" disabled={edit.busy || disabled} onClick={() => void submit(true)}>Skip question</Button>}
            {task && <Button size="sm" type="button" variant="ghost" disabled={edit.loading} onClick={() => void edit.closeDraft().then((closed) => { if (closed) onClose() })}>Discard draft</Button>}
          </div>
        </div>
      </form>
    </>}
    <p className="border-t pt-3 text-xs text-muted-foreground">Closing keeps your draft so you can return to it later.</p>
  </section>
}
