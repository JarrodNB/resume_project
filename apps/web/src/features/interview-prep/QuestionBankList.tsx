/**
 * Description: The question bank: every current practice question with its answer progress.
 * Shows one question type at a time and searches question, answer, and memory-anchor text in the browser.
 * Each row expands an answer editor here. Unsaved edits are protected when closing or leaving.
 * Practice rehearses saved answers from this same filtered selection in local state.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useBeforeUnload, useBlocker } from 'react-router'
import { ChevronRight } from 'lucide-react'
import type { InterviewQuestionBankQuery, InterviewQuestionSetTypeEnum } from '@/graphql/generated/graphql'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { InlineQuestionEditor } from './InlineQuestionEditor'
import { QuestionRehearsal } from './QuestionRehearsal'
import { interviewSetDate } from './interviewSetDate'
import { QUESTION_TYPES, interviewSetTypeLabel } from './interviewSetTypeLabel'
import { PROGRESS_LABELS, questionProgress } from './questionProgress'
import { DeleteQuestionButton } from './DeleteQuestionButton'
import { QuestionProgressMark } from './QuestionProgressMark'

type BankQuestion = InterviewQuestionBankQuery['interviewQuestions'][number]

/** Shows type tabs and searches within the selected type; rehearsal uses that selection. */
export function QuestionBankList({ questions }: { questions: BankQuestion[] }) {
  const [openQuestion, setOpenQuestion] = useState<BankQuestion | null>(null)
  const [dirty, setDirty] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const blocker = useBlocker(dirty)
  useBeforeUnload(useCallback((event) => {
    if (dirty) { event.preventDefault(); event.returnValue = '' }
  }, [dirty]))
  const onDirty = useCallback((_id: string, value: boolean) => setDirty(value), [])
  function changeSelection(action: () => void) {
    if (dirty) setPendingAction(() => action)
    else { setOpenQuestion(null); action() }
  }
  const [rehearsal, setRehearsal] = useState<BankQuestion[] | null>(null)
  const practiceButton = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  useEffect(() => {
    if (!rehearsal && restoreFocus.current) {
      practiceButton.current?.focus()
      restoreFocus.current = false
    }
  }, [rehearsal])
  const [setType, setSetType] = useState<InterviewQuestionSetTypeEnum>(questions[0]?.questionSet.setType ?? 'FIT_MOTIVATION')
  const [search, setSearch] = useState('')
  const rows = questions.map((question) => ({ question, progress: questionProgress(question) }))
  const term = search.trim().toLowerCase()
  const visible = rows.filter(({ question }) => !term || question.questionText.toLowerCase().includes(term) || question.answerText.toLowerCase().includes(term) || question.memoryAnchor.toLowerCase().includes(term))

  const group = visible.filter(({ question }) => question.questionSet.setType === setType)

  if (rehearsal) return <QuestionRehearsal questions={rehearsal} initialType={setType} onReturn={() => {
    restoreFocus.current = true
    setRehearsal(null)
  }} />

  return <section className="question-bank" aria-labelledby="question-bank-heading">
    <div className="question-bank-toolbar">
      <div className="flex flex-wrap items-center gap-4">
        <h2 id="question-bank-heading">Your questions</h2>
        <Button ref={practiceButton} onClick={() => changeSelection(() => setRehearsal(visible.map(({ question }) => question).filter((question) => !question.retiredAt && question.answerText.trim())))}>Practice</Button>
      </div>
      <div className="question-bank-search">
        <div className="question-bank-field">
          <label htmlFor="question-bank-search">Search questions and answers</label>
          <Input id="question-bank-search" type="search" placeholder="Question, answer, or memory anchor" value={search} onChange={(event) => { const value = event.target.value; changeSelection(() => setSearch(value)) }} />
        </div>
      </div>
    </div>
    <div className="question-type-tabs" role="tablist" aria-label="Question types">
      {QUESTION_TYPES.map((type, index) => <button key={type} type="button" role="tab"
        id={`question-tab-${type}`} aria-controls="question-type-panel" aria-selected={setType === type}
        tabIndex={setType === type ? 0 : -1} className={`section-tab${setType === type ? ' is-active' : ''}`}
        onClick={() => { if (type !== setType) changeSelection(() => setSetType(type)) }} onKeyDown={(event) => {
          const next = event.key === 'ArrowRight' ? (index + 1) % QUESTION_TYPES.length
            : event.key === 'ArrowLeft' ? (index + QUESTION_TYPES.length - 1) % QUESTION_TYPES.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? QUESTION_TYPES.length - 1 : null
          if (next === null) return
          event.preventDefault()
          changeSelection(() => setSetType(QUESTION_TYPES[next]))
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
        }}>
        {interviewSetTypeLabel(type)} <span className="question-filter-count">{visible.filter(({ question }) => question.questionSet.setType === type).length}</span>
      </button>)}
    </div>
    <Dialog open={pendingAction !== null || blocker.state === 'blocked'} onOpenChange={(open) => {
      if (!open) { setPendingAction(null); if (blocker.state === 'blocked') blocker.reset() }
    }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Discard unsaved answer?</DialogTitle><DialogDescription>Your answer or memory anchor has unsaved changes.</DialogDescription></DialogHeader>
        <DialogFooter>
          <Button onClick={() => { setPendingAction(null); if (blocker.state === 'blocked') blocker.reset() }}>Keep editing</Button>
          <Button variant="outline" onClick={() => {
            setDirty(false)
            setOpenQuestion(null)
            pendingAction?.()
            setPendingAction(null)
            if (blocker.state === 'blocked') blocker.proceed()
          }}>Discard changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <div id="question-type-panel" role="tabpanel" aria-labelledby={`question-tab-${setType}`} tabIndex={0}>
      {group.length === 0
        ? <p className="question-bank-none">{search.trim() ? 'No questions match your search.' : 'No questions of this type yet.'}</p>
        : <ul className="record-list">
            {group.map(({ question, progress }) => <li key={question.id} className="question-bank-item">
              <div className="flex items-center gap-2">
                <button type="button" aria-expanded={openQuestion?.id === question.id} aria-controls={`inline-answer-${question.id}`} onClick={() => changeSelection(() => setOpenQuestion(openQuestion?.id === question.id ? null : question))} className="question-row min-w-0 flex-1 text-left">
                  <QuestionProgressMark progress={progress} />
                  <span className="question-row-text">
                    <span className="question-row-title">{question.questionText}</span>
                    <span className="question-row-meta">{PROGRESS_LABELS[progress]} · {interviewSetTypeLabel(question.questionSet.setType)} · {interviewSetDate(question.questionSet.createdAt)}</span>
                    {question.answerText.trim() && <span className="question-row-answer">{question.answerText}</span>}
                  </span>
                  <ChevronRight className="record-arrow" aria-hidden="true" />
                </button>
                {openQuestion?.id !== question.id && <DeleteQuestionButton setId={question.questionSet.id} questionId={question.id} questionText={question.questionText}
                  disabled={question.latestTask?.status === 'QUEUED' && question.latestTask.taskType === 'REGENERATE_INTERVIEW_QUESTION'} />}
              </div>
              {openQuestion?.id === question.id && <div id={`inline-answer-${question.id}`} className="question-inline-editor">
                <InlineQuestionEditor setId={question.questionSet.id} questionId={question.id} onDirty={onDirty}
                  onDeleted={() => { setDirty(false); setOpenQuestion(null) }} />
              </div>}
            </li>)}
          </ul>
      }
    </div>
  </section>
}
