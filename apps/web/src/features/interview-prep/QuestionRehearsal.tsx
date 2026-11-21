/** Recall saved answers from the bank's current selection, without saving progress or running AI.
 * Answers enter the page only when revealed. Returning leaves bank filters intact.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import type { InterviewQuestionBankQuery } from '@/graphql/generated/graphql'

type BankQuestion = InterviewQuestionBankQuery['interviewQuestions'][number]

export function QuestionRehearsal({ questions, onReturn }: { questions: BankQuestion[]; onReturn: () => void }) {
  const [order, setOrder] = useState(questions)
  const [shuffled, setShuffled] = useState(false)
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const question = order[index]
  useEffect(() => { heading.current?.focus() }, [index, order])
  function move(next: number) {
    if (next < 0 || next >= order.length) return
    setRevealed(false)
    setIndex(next)
  }

  function shuffle() {
    const next = [...questions]
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

  if (!question) return <section className="space-y-4" aria-label="Question rehearsal">
    <h2 ref={heading} tabIndex={-1} className="break-words text-xl font-semibold">No answers to practice</h2>
    <p>No saved answers match these filters. Save an answer or change your filters to practice.</p>
    <Button variant="outline" onClick={onReturn}>Return to question bank</Button>
  </section>

  return <section className="space-y-4" aria-label="Question rehearsal" onKeyDown={navigate}>
    <Button variant="outline" onClick={onReturn}>Return to question bank</Button>
    <p className="text-sm text-muted-foreground">Recall your saved answer, then reveal it to check. Use Left and Right arrow keys to move.</p>
    <p role="status">Question {index + 1} of {order.length}</p>
    <h2 ref={heading} tabIndex={-1} className="break-words text-xl font-semibold">{question.questionText}</h2>
    {question.memoryAnchor.trim() && <p className="whitespace-pre-wrap break-words"><strong>Memory anchor:</strong> {question.memoryAnchor}</p>}
    <Button aria-expanded={revealed} onClick={() => setRevealed(!revealed)}>{revealed ? 'Hide answer' : 'Reveal answer'}</Button>
    {revealed && <p className="whitespace-pre-wrap break-words">{question.answerText}</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={index === 0} onClick={() => move(index - 1)}>Previous</Button>
      <Button variant="outline" disabled={index === order.length - 1} onClick={() => move(index + 1)}>Next</Button>
      <Button variant="outline" disabled={shuffled && index < order.length - 1} onClick={shuffle}>Shuffle</Button>
      <Button variant="outline" asChild><Link to={`/practice/questions/${question.questionSet.id}/${question.id}`}>Edit answer</Link></Button>
    </div>
    {shuffled && index < order.length - 1 && <p className="text-sm text-muted-foreground">Finish this pass to shuffle again.</p>}
  </section>
}
