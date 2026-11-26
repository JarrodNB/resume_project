/**
 * Description: One practice question: write and save an answer, get coaching, replace it, or permanently delete it.
 * Get feedback and Generate anchor save the typed answer and recall cue first. Replacing an answered question keeps the old answer
 * as a read-only copy on the practice page. "Don't show this again" only affects future questions.
 */
import { useEffect, useState } from 'react'
import { Ellipsis, LoaderCircle } from 'lucide-react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { MutationErrorAlert } from '@/features/billing/PlanBillingLink'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { INTERVIEW_ANSWER_TEXT, INTERVIEW_MEMORY_ANCHOR_TEXT } from '@/lib/textLimits'
import type { InterviewSetQuery } from '@/graphql/generated/graphql'
import { InterviewFeedback } from './InterviewFeedback'
import { InterviewTaskStatus } from './InterviewTaskStatus'
import { useInterviewAnswer } from './useInterviewAnswer'
import { DeleteQuestionDialog } from './DeleteQuestionDialog'
import { useQuestionAvoidance } from './useQuestionAvoidance'
import { answerFieldHelp, answerFormats, isBlankAnswer, normalizeAnswerDrafts, normalizeAnswerFormat, normalizeAnswerForComparison, projectAnswer } from './answerFormats'

type Question = InterviewSetQuery['interviewQuestionSet']['questions'][number]
/** Keeps drafts and subscriptions alive while the question is open. */
export function InterviewQuestionCard({ question, setId, manual, refetch, onDirty, onDeleted }: { question: Question; setId: string; manual: boolean; refetch: () => Promise<unknown>; onDirty: (id: string, dirty: boolean) => void; onDeleted: () => void }) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const avoidance = useQuestionAvoidance(setId, question.id, question.questionRevision, question.avoided)
  const [edits, setEdits] = useState(0)
  const [submittedEdits, setSubmittedEdits] = useState<number | null>(null)
  const [anchor, setAnchor] = useState(question.memoryAnchor)
  const [anchorBaseline, setAnchorBaseline] = useState(question.memoryAnchor)
  const [serverAnchor, setServerAnchor] = useState(question.memoryAnchor)
  const [checkAnchor, setCheckAnchor] = useState(false)
  const saved = { format: normalizeAnswerFormat(question.answerFormat), drafts: normalizeAnswerDrafts(question.answerDrafts, question.answerText) }
  const savedKey = JSON.stringify(saved)
  const [draft, setDraft] = useState(saved)
  const [baselineDraft, setBaselineDraft] = useState(saved)
  const [serverAnswer, setServerAnswer] = useState(savedKey)
  const answer = projectAnswer(draft.format, draft.drafts)
  const baseline = projectAnswer(baselineDraft.format, baselineDraft.drafts)
  const [revision, setRevision] = useState(question.questionRevision)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [task, setTask] = useState(question.latestTask)
  const [observedTask, setObservedTask] = useState(question.latestTask)
  const { run, busy, errors, errorCode } = useInterviewAnswer(setId, question.id)
  const [replacementRevision, setReplacementRevision] = useState(question.latestTask?.status === 'QUEUED' && question.latestTask.taskType === 'REGENERATE_INTERVIEW_QUESTION' ? question.questionRevision : null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baselineDraft) || anchor !== anchorBaseline
  // Unsaved edits only exist in the browser, so this one freshness check stays client-side. It uses the same
  // comparison as the server (normalizeAnswerForComparison matches ActiveAnswer.normalize); saved state is the server's.
  const feedbackDraftChanged = draft.format !== baselineDraft.format || normalizeAnswerForComparison(answer) !== normalizeAnswerForComparison(baseline)
  const replacing = replacementRevision !== null && task?.taskType === 'REGENERATE_INTERVIEW_QUESTION' && task.status !== 'FAILED' && question.questionRevision === replacementRevision
  const anchoring = task?.status === 'QUEUED' && task.taskType === 'GENERATE_INTERVIEW_MEMORY_ANCHOR'
  const reviewing = task?.status === 'QUEUED' && task.taskType === 'REVIEW_INTERVIEW_ANSWER'
  const feedbackForVersion = !question.feedbackOutdated && question.feedbackQuestionRevision === question.questionRevision && question.feedbackAnswerRevision === question.answerRevision
  useEffect(() => { onDirty(question.id, dirty) }, [question.id, dirty, onDirty])
  // Reconcile external saved revisions without replacing a locally edited draft.
  if (question.questionRevision !== revision) {
    setRevision(question.questionRevision)
    setDraft(saved)
    setBaselineDraft(saved)
    setServerAnswer(savedKey)
    setAnchor(question.memoryAnchor)
    setAnchorBaseline(question.memoryAnchor)
    setServerAnchor(question.memoryAnchor)
    setCheckAnchor(false)
  } else if (savedKey !== serverAnswer || question.memoryAnchor !== serverAnchor) {
    if (JSON.stringify(draft) === JSON.stringify(baselineDraft) && (submittedEdits === null || submittedEdits === edits)) setDraft(saved)
    if (anchor === anchorBaseline && (submittedEdits === null || submittedEdits === edits)) setAnchor(question.memoryAnchor)
    setAnchorBaseline(question.memoryAnchor)
    setServerAnchor(question.memoryAnchor)
    setSubmittedEdits(null)
    setBaselineDraft(saved)
    setServerAnswer(savedKey)
  }
  if (question.latestTask?.id !== observedTask?.id || question.latestTask?.status !== observedTask?.status) {
    setObservedTask(question.latestTask)
    setTask(question.latestTask)
    if (question.latestTask?.status === 'QUEUED' && question.latestTask.taskType === 'REGENERATE_INTERVIEW_QUESTION') setReplacementRevision(question.questionRevision)
  }
  /** Preserves edits made during a request and refreshes answers saved before queue errors. */
  async function perform(operation: 'save' | 'feedback' | 'replace' | 'anchor') {
    const submitted = answer
    const submittedDraft = draft
    const submittedAnchor = anchor
    setSubmittedEdits(edits)
    const result = await run(operation, submitted, submittedAnchor, submittedDraft.format, submittedDraft.drafts)
    if (result.ok && operation !== 'replace') { setBaselineDraft(submittedDraft); setAnchorBaseline(submittedAnchor) }
    if (result.task) {
      setTask(result.task)
      if (operation === 'replace') setReplacementRevision(question.questionRevision)
    }
    if (result.ok && operation === 'replace') setConfirmOpen(false)
    try { await refetch() } catch { /* The page query exposes refresh errors and keeps the draft available. */ }
  }
  const oversizedFormats = (Object.keys(answerFormats) as (keyof typeof answerFormats)[]).filter((format) => projectAnswer(format, draft.drafts).length > INTERVIEW_ANSWER_TEXT)
  const canRequestFeedback = oversizedFormats.length === 0 && !busy && !replacing && !reviewing && !anchoring && !(feedbackForVersion && !feedbackDraftChanged) &&
    !isBlankAnswer(answer) && answer.length <= INTERVIEW_ANSWER_TEXT && anchor.length <= INTERVIEW_MEMORY_ANCHOR_TEXT
  const saveStatus = busy === 'save' ? 'Saving…' : busy === 'feedback' ? 'Saving and sending for feedback…'
    : busy === 'anchor' ? 'Saving and generating anchor…' : anchoring ? 'Generating memory anchor. You can keep editing.' : reviewing ? 'Getting feedback. You can keep editing.' : dirty ? 'Unsaved changes' : 'Saved'
  return <article className="question-card" aria-labelledby={`question-${question.id}`}>
    {task && <InterviewTaskStatus key={task.id} task={task} onFinished={refetch} operation={task.taskType === 'GENERATE_INTERVIEW_MEMORY_ANCHOR' ? 'anchor' : task.taskType === 'REVIEW_INTERVIEW_ANSWER' ? 'feedback' : 'replacement'} />}
    <header className="question-card-header">
      <h2 id={`question-${question.id}`} className="question-card-title">{question.questionText}</h2>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Question actions"><Ellipsis /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!manual && <DropdownMenuItem disabled={!!busy || replacing || reviewing || anchoring} onSelect={() => { if (Object.values(draft.drafts).some((fields) => Object.values(fields).some((text) => text.trim())) || Object.values(saved.drafts).some((fields) => Object.values(fields).some((text) => text.trim()))) setConfirmOpen(true); else void perform('replace') }}>Replace question</DropdownMenuItem>}
          <DropdownMenuItem disabled={avoidance.saved || avoidance.saving || replacing || busy === 'replace'} onSelect={() => void avoidance.save()}>
            {avoidance.saved ? 'Hidden from new questions' : "Don't show this again"}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!!busy || replacing || avoidance.saving} onSelect={() => setDeleteOpen(true)}>Delete question</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
    {(avoidance.saved || avoidance.saving) && <p role="status" className="text-sm text-muted-foreground">{avoidance.saving ? 'Saving preference…' : "Saved. New questions won't repeat this one."}</p>}
    <ErrorAlert title="Couldn't save preference" messages={avoidance.errors} />
    <div className="question-card-body">
      <div className="grid min-w-0 content-start gap-3">
        <div className="question-answer-format">
          <label htmlFor={`format-${question.id}`} className="font-bold">Answer format</label>
          <select id={`format-${question.id}`} className="question-format-select" aria-describedby={`format-help-${question.id} format-drafts-${question.id}`} value={draft.format} disabled={replacing || busy === 'replace'} onChange={(event) => { setEdits((count) => count + 1); setDraft({ ...draft, format: normalizeAnswerFormat(event.target.value) }); setCheckAnchor(true) }}>
            {Object.entries(answerFormats).map(([value, definition]) => <option key={value} value={value}>{definition.label}</option>)}
          </select>
          <p id={`format-help-${question.id}`} className="text-sm">{answerFormats[draft.format].explanation}</p>
          <p id={`format-drafts-${question.id}`} className="text-sm text-muted-foreground">Story formats suit experience questions; use only facts you can support. Each format keeps a separate draft.</p>
        </div>
        {Object.entries(answerFormats[draft.format].fields).map(([field, label]) => <div key={`${draft.format}-${field}`} className="grid gap-2">
          <label htmlFor={`answer-${question.id}-${field}`} className="font-bold">{label}</label>
          {answerFieldHelp[field] && <p id={`field-help-${question.id}-${field}`} className="text-sm text-muted-foreground">{answerFieldHelp[field]}</p>}
          <Textarea aria-describedby={answerFieldHelp[field] ? `field-help-${question.id}-${field}` : undefined} id={`answer-${question.id}-${field}`} value={draft.drafts[draft.format][field]} maxLength={INTERVIEW_ANSWER_TEXT} disabled={replacing || busy === 'replace'} onChange={(event) => { setEdits((count) => count + 1); setDraft({ ...draft, drafts: { ...draft.drafts, [draft.format]: { ...draft.drafts[draft.format], [field]: event.target.value } } }); setCheckAnchor(true) }} className={draft.format === 'plain_text' ? 'min-h-64' : 'min-h-24'} />
        </div>)}
        <div className="question-answer-status">
          <p role="status">{saveStatus}</p>
          <p>{answer.length.toLocaleString()} / {INTERVIEW_ANSWER_TEXT.toLocaleString()}</p>
        </div>
        <div className="question-memory-anchor">
          <label htmlFor={`anchor-${question.id}`} className="font-bold">Memory anchor</label>
          <p id={`anchor-help-${question.id}`} className="text-sm text-muted-foreground">Optional: compress each answer sentence into a cue, in the same order. Write your own or generate one, then edit it.</p>
          <Textarea id={`anchor-${question.id}`} aria-describedby={`anchor-help-${question.id}`} className="min-h-24" value={anchor} maxLength={INTERVIEW_MEMORY_ANCHOR_TEXT} disabled={replacing || busy === 'replace'} onChange={(event) => { setEdits((count) => count + 1); setAnchor(event.target.value); setCheckAnchor(false) }} />
          <Button variant="outline" className="justify-self-start" disabled={!!busy || replacing || reviewing || anchoring || oversizedFormats.length > 0 || !answer.trim() || answer.length > INTERVIEW_ANSWER_TEXT || anchor.length > INTERVIEW_MEMORY_ANCHOR_TEXT} onClick={() => void perform('anchor')}>
            {(busy === 'anchor' || anchoring) && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
            {busy === 'anchor' || anchoring ? 'Generating anchor…' : anchor.trim() ? 'Regenerate anchor' : 'Generate anchor'}
          </Button>
          <p className="text-sm text-muted-foreground">{anchor.length} / {INTERVIEW_MEMORY_ANCHOR_TEXT}</p>
          {checkAnchor && anchor.trim() && <p className="text-sm text-muted-foreground">You changed your answer. Check that your memory anchor still fits.</p>}
        </div>
        {oversizedFormats.length > 0 && <p role="alert">Shorten {oversizedFormats.map((format) => answerFormats[format].label).join(', ')} to {INTERVIEW_ANSWER_TEXT.toLocaleString()} characters including section labels before saving.</p>}
        <MutationErrorAlert title="Couldn't complete this action" errors={errors} errorCode={errorCode} />
        <div className="flex flex-wrap gap-2">
          <Button disabled={!canRequestFeedback} onClick={() => void perform('feedback')}>
            {(busy === 'feedback' || reviewing) && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
            {busy === 'feedback' ? 'Sending…' : reviewing ? 'Getting feedback…' : 'Get feedback'}
          </Button>
          <Button variant="outline" disabled={!!busy || replacing || !dirty || oversizedFormats.length > 0} onClick={() => void perform('save')}>Save</Button>
        </div>
        {feedbackForVersion && !feedbackDraftChanged && !reviewing && <p className="text-sm text-muted-foreground">This feedback is for your current answer. Change your answer to get new feedback.</p>}
      </div>
      <InterviewFeedback feedback={question.feedback} outdated={question.feedbackOutdated || feedbackDraftChanged} unsavedChanges={feedbackDraftChanged} />
    </div>
    <Dialog open={confirmOpen} onOpenChange={(open) => { if (!busy) setConfirmOpen(open) }}><DialogContent><DialogHeader><DialogTitle>Replace this question?</DialogTitle><DialogDescription>Your saved answer, memory anchor, and feedback are kept under “Answers from replaced questions” on the practice page.{dirty ? ' Unsaved changes will be lost.' : ''} If replacement fails, nothing changes.</DialogDescription></DialogHeader><MutationErrorAlert title="Couldn't replace question" errors={errors} errorCode={errorCode} /><DialogFooter><DialogClose asChild><Button variant="outline" disabled={!!busy}>Cancel</Button></DialogClose><Button disabled={!!busy} onClick={() => void perform('replace')}>Replace question</Button></DialogFooter></DialogContent></Dialog>
    <DeleteQuestionDialog setId={setId} questionId={question.id} questionText={question.questionText} dirty={dirty} open={deleteOpen} onOpenChange={setDeleteOpen} onDeleted={onDeleted} />
  </article>
}
