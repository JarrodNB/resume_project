/** Presents requested coaching separately from the immutable interview transcript.
 * Opening the section never starts generation; the candidate explicitly chooses that action.
 */
import { ArrowUpRight, Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { SectionCard } from '@/components/SectionCard'
import { useInterviewSessionFeedback, type SavedSessionFeedback } from './useInterviewSessionFeedback'

type Props = { interviewId: string; saved: SavedSessionFeedback; hasAnswers: boolean; questions: { id: string; content: string; position: number }[] }

export function CompletedInterviewFeedback({ interviewId, saved, hasAnswers, questions }: Props) {
  const feedback = useInterviewSessionFeedback(interviewId, saved)
  return <SectionCard tone="career_contexts" title="Interview feedback" sectionId={`spoken:review:${interviewId}:feedback`} contentClassName="grid gap-4"
    description="Generate coaching from your saved answers when you are ready.">
    {!hasAnswers ? <p className="text-sm text-muted-foreground">No answers were submitted. Complete another interview to get feedback.</p> : <>
      {!feedback.content && !feedback.pending && !feedback.failed && <Button className="justify-self-start" onClick={() => void feedback.generate()}>Generate feedback</Button>}
      {feedback.pending && <p role="status" className="text-sm">Generating interview feedback. You can leave and reopen this interview.</p>}
      {feedback.error && <p role="alert" className="text-sm">{feedback.error}</p>}
      {feedback.subscriptionError && <p role="status" className="text-sm">{feedback.subscriptionError}</p>}
      {feedback.failed && !feedback.pending && feedback.canRetry && <Button className="justify-self-start" variant="outline" onClick={() => void feedback.generate(true)}>Retry feedback</Button>}
      {feedback.failed && !feedback.canRetry && <p className="text-sm">This interview has reached its feedback retry limit.</p>}
      {feedback.content && <>
        <div className="grid gap-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Overall</h3>
          <p className="max-w-prose whitespace-pre-wrap break-words text-base leading-relaxed">{feedback.content.summary}</p>
        </div>
        {questions.toSorted((a, b) => a.position - b.position).map((question) => {
          const item = feedback.content?.questions.find((entry) => entry.question_id === question.id)
          return item ? <section key={question.id} className="grid gap-4 border-t pt-5">
            <h3 className="grid max-w-prose gap-0.5 text-base font-semibold leading-snug text-balance">
              <span className="text-sm font-medium text-muted-foreground">Core question {question.position + 1}:</span>{' '}
              <span>{question.content}</span>
            </h3>
            <div className="grid gap-4 md:grid-cols-2 md:gap-6">
              <FeedbackPoints title="Strengths" points={item.strengths} icon={<Check aria-hidden className="size-4 text-signal-done-text" />} />
              <FeedbackPoints title="Improvements" points={item.improvements} icon={<ArrowUpRight aria-hidden className="size-4 text-signal-action-text" />} />
            </div>
            <div className="grid gap-2 rounded-md bg-muted p-4 text-sm">
              <h4 className="font-semibold">Example answer</h4>
              <p className="max-w-prose text-xs text-muted-foreground">Illustrative wording. Check that every personal detail is true before using it.</p>
              <p className="max-w-prose whitespace-pre-wrap break-words leading-relaxed">{item.example_answer}</p>
            </div>
          </section> : null
        })}
      </>}
    </>}
  </SectionCard>
}

function FeedbackPoints({ title, points, icon }: { title: string; points: string[]; icon: ReactNode }) {
  return <div className="grid content-start gap-2 text-sm">
    <h4 className="font-semibold">{title}</h4>
    <ul className="grid gap-2.5">{points.map((text, index) => <li key={index} className="grid max-w-prose grid-cols-[1rem_1fr] gap-2 break-words leading-relaxed"><span className="mt-0.5">{icon}</span><span>{text}</span></li>)}</ul>
  </div>
}
