/** Recall saved answers by type within the bank's current search, without saving progress or running AI.
 * Answers enter the page only when revealed. Returning leaves the bank search intact.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { MultiSelect } from '@/components/MultiSelect'
import { Button } from '@/components/ui/button'
import type { InterviewQuestionBankQuery, InterviewQuestionSetTypeEnum } from '@/graphql/generated/graphql'

import { QUESTION_TYPES, interviewSetTypeLabel } from './interviewSetTypeLabel'

type BankQuestion = InterviewQuestionBankQuery['interviewQuestions'][number]

export function QuestionRehearsal({ questions, initialType, onReturn }: { questions: BankQuestion[]; initialType: InterviewQuestionSetTypeEnum; onReturn: () => void }) {
  const [setTypes, setSetTypes] = useState([initialType])
  const selected = questions.filter((question) => setTypes.includes(question.questionSet.setType))
  const [order, setOrder] = useState(selected)
  const [shuffled, setShuffled] = useState(false)
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const question = order[index]
  useEffect(() => {
    if (!document.activeElement?.closest('[data-slot="popover-content"]')) heading.current?.focus()
  }, [index, order])
  function move(next: number) {
    if (next < 0 || next >= order.length) return
    setRevealed(false)
    setIndex(next)
  }

  function shuffle() {
    const next = [...selected]
    for (let position = next.length - 1; position > 0; position--) {
      const other = Math.floor(Math.random() * (position + 1))
      ;[next[position], next[other]] = [next[other], next[position]]
    }
    setOrder(next)
    setIndex(0)
    setRevealed(false)
    setShuffled(true)
  }
  function navigate(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      move(index + (event.key === 'ArrowRight' ? 1 : -1))
    }
  }

  return <section className="question-card question-rehearsal" aria-label="Question rehearsal" onKeyDown={navigate}>
    <Button variant="outline" onClick={onReturn}>Return to question bank</Button>
    <div className="question-bank-field">
      <label id="rehearsal-question-types-label" htmlFor="rehearsal-question-types">Question types</label>
      <MultiSelect id="rehearsal-question-types" labelId="rehearsal-question-types-label" emptyLabel="Choose question types"
        options={QUESTION_TYPES.map((type) => ({ value: type, label: `${interviewSetTypeLabel(type)} (${questions.filter((question) => question.questionSet.setType === type).length})` }))}
        selected={setTypes} onChange={(types) => {
          setSetTypes(types)
          setOrder(questions.filter((question) => types.includes(question.questionSet.setType)))
          setIndex(0)
          setRevealed(false)
          setShuffled(false)
        }} />
    </div>
    {!question ? <>
      <h2 ref={heading} tabIndex={-1} className="question-card-title">No answers to practice</h2>
      <p>No saved answers in the selected types match your bank search. Choose question types or return to save an answer.</p>
    </> : <>
    <p className="text-sm text-muted-foreground">Recall your saved answer, then reveal it to check. Use Left and Right arrow keys to move.</p>
    <p className="question-rehearsal-position" role="status">Question {index + 1} of {order.length}</p>
    <h2 ref={heading} tabIndex={-1} className="question-card-title">{question.questionText}</h2>
    {question.memoryAnchor.trim() && <p className="question-rehearsal-anchor whitespace-pre-wrap break-words"><strong>Memory anchor:</strong> {question.memoryAnchor}</p>}
    <Button aria-expanded={revealed} onClick={() => setRevealed(!revealed)}>{revealed ? 'Hide answer' : 'Reveal answer'}</Button>
    {revealed && <p className="question-rehearsal-answer whitespace-pre-wrap break-words">{question.answerText}</p>}
    <div className="question-rehearsal-actions flex flex-wrap gap-2">
      <Button variant="outline" disabled={index === 0} onClick={() => move(index - 1)}>Previous</Button>
      <Button variant="outline" disabled={index === order.length - 1} onClick={() => move(index + 1)}>Next</Button>
      <Button variant="outline" disabled={shuffled && index < order.length - 1} onClick={shuffle}>Shuffle</Button>
      <Button variant="outline" asChild><Link to={`/practice/questions/${question.questionSet.id}/${question.id}`}>Edit answer</Link></Button>
    </div>
    {shuffled && index < order.length - 1 && <p className="text-sm text-muted-foreground">Finish this pass to shuffle again.</p>}
    </>}
  </section>
}
