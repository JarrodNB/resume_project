/** Collects any answered review questions in one submission, preserving their saved positions. */
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { LibraryReviewAnswerInput } from '@/graphql/generated/graphql'
import { PROSE_TEXT } from '@/lib/textLimits'

interface Props {
  questions: string[]
  stale: boolean
  disabled: boolean
  onSubmit: (answers: LibraryReviewAnswerInput[]) => Promise<boolean>
}

export function ReviewAnswerForm({ questions, stale, disabled, onSubmit }: Props) {
  const [answers, setAnswers] = useState(() => questions.map(() => ''))
  const answerId = useId()
  const entered = answers.map((answer, questionIndex) => ({ questionIndex, answer: answer.trim() })).filter((item) => item.answer)
  return <form className="grid gap-3 border-t pt-4" onSubmit={(event) => { event.preventDefault(); if (!stale && !disabled && entered.length > 0) void onSubmit(entered) }}>
    <h4 className="font-medium">A little more context</h4>
    <p id={`${answerId}-help`} className="text-xs text-muted-foreground">Answer at least one question. You can leave the others blank. Your answers generate one draft for you to accept.</p>
    {stale && <p role="status">These questions are based on earlier text. Review this section again.</p>}
    {questions.map((question, index) => <div key={index} className="grid gap-2">
      <p id={`${answerId}-${index}-question`} className="leading-relaxed">{question}</p>
      <Label htmlFor={`${answerId}-${index}`}>{questions.length === 1 ? 'Your answer' : `Your answer to question ${index + 1} (optional)`}</Label>
      <Textarea id={`${answerId}-${index}`} aria-describedby={`${answerId}-${index}-question ${answerId}-help`} value={answers[index]} onChange={(event) => setAnswers((current) => current.map((answer, position) => position === index ? event.target.value : answer))} maxLength={PROSE_TEXT} disabled={disabled || stale} rows={3} />
    </div>)}
    <Button size="sm" type="submit" className="w-full" disabled={disabled || stale || entered.length === 0}>Generate revision from {questions.length === 1 ? 'answer' : 'answers'}</Button>
  </form>
}
