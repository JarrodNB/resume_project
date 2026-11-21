/** Save a question brought by the candidate; no library or AI work is required. */
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { SectionCard } from '@/components/SectionCard'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ErrorAlert } from '@/components/ErrorAlert'
import type { InterviewQuestionSetTypeEnum } from '@/graphql/generated/graphql'
import { interviewSetTypeLabel } from './interviewSetTypeLabel'
import { useCreateCustomQuestion } from './useInterviewPrep'

const TYPES: InterviewQuestionSetTypeEnum[] = ['FIT_MOTIVATION', 'BEHAVIORAL', 'HYPOTHETICAL', 'TECHNICAL', 'KNOWLEDGE']

export function AddCustomQuestion() {
  const [type, setType] = useState<InterviewQuestionSetTypeEnum>('FIT_MOTIVATION')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const creation = useCreateCustomQuestion()
  const navigate = useNavigate()
  return <SectionCard tone="summary" title="Add your own question" sectionId="custom-interview-question">
    <form className="grid gap-4" onSubmit={(event) => {
      event.preventDefault()
      void creation.create(type, question, answer).then((id) => { if (id) void navigate(`/practice/questions/${id}`) })
    }}>
      <p>Bring a question you want to practice. You can add an answer now or write it later.</p>
      <fieldset disabled={creation.loading} className="grid gap-4">
        <legend>Question type</legend>
        <div className="view-switch flex-wrap" role="group" aria-label="Custom question type">
          {TYPES.map((value) => <button key={value} type="button" aria-pressed={type === value} onClick={() => setType(value)}>{interviewSetTypeLabel(value)}</button>)}
        </div>
        <div><Label htmlFor="custom-question">Question</Label><Textarea id="custom-question" required maxLength={2000} value={question} onChange={(event) => setQuestion(event.target.value)} /></div>
        <div><Label htmlFor="custom-answer">Initial answer (optional)</Label><Textarea id="custom-answer" maxLength={2000} value={answer} onChange={(event) => setAnswer(event.target.value)} /></div>
        <Button type="submit" disabled={!question.trim()}>{creation.loading ? 'Adding…' : 'Add question'}</Button>
      </fieldset>
      <ErrorAlert title="Couldn't add your question" messages={creation.errors} />
    </form>
  </SectionCard>
}
