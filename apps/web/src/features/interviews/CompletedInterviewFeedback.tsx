/** Presents requested coaching separately from the immutable interview transcript.
 * Opening the section never starts generation; the candidate explicitly chooses that action.
 */
import { Button } from '@/components/ui/button'
import { SectionCard } from '@/components/SectionCard'
import { useInterviewSessionFeedback, type SavedSessionFeedback } from './useInterviewSessionFeedback'

type Props = { interviewId: string; saved: SavedSessionFeedback; hasAnswers: boolean; questions: { id: string; content: string; position: number }[] }

export function CompletedInterviewFeedback({ interviewId, saved, hasAnswers, questions }: Props) {
  const feedback = useInterviewSessionFeedback(interviewId, saved)
  return <SectionCard tone="facts" title="Interview feedback" sectionId={`spoken:review:${interviewId}:feedback`} contentClassName="grid gap-4"
    description="Generate coaching from your saved answers when you are ready.">
    {!hasAnswers ? <p className="text-sm text-muted-foreground">No answers were submitted. Complete another interview to get feedback.</p> : <>
      {!feedback.content && !feedback.pending && !feedback.failed && <Button className="justify-self-start" onClick={() => void feedback.generate()}>Generate feedback</Button>}
      {feedback.pending && <p role="status" className="text-sm">Generating interview feedback. You can leave and reopen this interview.</p>}
      {feedback.error && <p role="alert" className="text-sm">{feedback.error}</p>}
      {feedback.subscriptionError && <p role="status" className="text-sm">{feedback.subscriptionError}</p>}
      {feedback.failed && !feedback.pending && feedback.canRetry && <Button className="justify-self-start" variant="outline" onClick={() => void feedback.generate(true)}>Retry feedback</Button>}
      {feedback.failed && !feedback.canRetry && <p className="text-sm">This interview has reached its feedback retry limit.</p>}
      {feedback.content && <>
        <p className="max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed">{feedback.content.summary}</p>
        {questions.toSorted((a, b) => a.position - b.position).map((question) => {
          const item = feedback.content?.questions.find((entry) => entry.question_id === question.id)
          return item ? <section key={question.id} className="grid gap-3 border-t pt-4">
            <h3 className="text-sm font-semibold">Core question {question.position + 1}: {question.content}</h3>
            <div className="grid gap-2 text-sm"><h4 className="font-medium">Strengths</h4><ul className="list-disc space-y-1 pl-5">{item.strengths.map((text, index) => <li key={index} className="max-w-prose break-words">{text}</li>)}</ul></div>
            <div className="grid gap-2 text-sm"><h4 className="font-medium">Improvements</h4><ul className="list-disc space-y-1 pl-5">{item.improvements.map((text, index) => <li key={index} className="max-w-prose break-words">{text}</li>)}</ul></div>
            <div className="grid gap-2 text-sm"><h4 className="font-medium">Example answer</h4><p className="text-muted-foreground">Illustrative wording. Check that every personal detail is true before using it.</p><p className="max-w-prose whitespace-pre-wrap break-words leading-relaxed">{item.example_answer}</p></div>
          </section> : null
        })}
      </>}
    </>}
  </SectionCard>
}
