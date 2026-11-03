/** Shows a review grade, explanation, and up to three questions about missing evidence.
 * Grades use the signal colors: red needs you, green is good, and "could improve" stays in ink.
 * Outdated feedback loses its grade so it cannot look like current advice.
 * An optional action sits beside the grade, leaving its questions at the full text width.
 * When the questions can be answered, they sit in a red "needs you" box with the answer button,
 * so a question waiting on the user is hard to miss.
 */
import type { ReactNode } from 'react'

export interface Assessment {
  kind: string
  recordId: string
  field: string
  color: string
  reason: string
  question?: string | null
  questions?: readonly string[]
  reviewTaskId?: string | null
  stale: boolean
}

const grades: Record<string, { label: string; className: string; dot: string }> = {
  red: { label: 'Needs work', className: 'text-signal-action-text', dot: 'is-action' },
  yellow: { label: 'Could improve', className: 'text-foreground', dot: 'is-partial' },
  green: { label: 'Looks good', className: 'text-signal-done-text', dot: 'is-done' },
}

export function LibraryAssessment({ assessment, action, answerAction }: { assessment?: Assessment; action?: ReactNode; answerAction?: ReactNode }) {
  const grade = assessment && !assessment.stale ? grades[assessment.color] : null
  const questions = assessment?.questions ?? (assessment?.question ? [assessment.question] : [])
  return (
    <div className="library-assessment">
      <div className="library-assessment-grade">
        <span className={`inline-flex items-center gap-2 font-semibold ${grade?.className ?? 'text-muted-foreground'}`}>
          <span className={`signal-dot ${grade?.dot ?? 'is-off'}`} aria-hidden />
          {grade?.label ?? (assessment?.stale ? 'Needs review' : 'Not reviewed')}
        </span>
        {action}
      </div>
      {grade && assessment?.reason && <p className="text-pretty text-muted-foreground">{assessment.reason}</p>}
      {grade && questions.length > 0 && (answerAction ? (
        <div className="review-questions">
          <p className="review-questions-title"><span className="signal-dot is-action" aria-hidden />{questions.length > 1 ? `The review has ${questions.length} questions for you` : 'The review has a question for you'}</p>
          <ul>{questions.map((question) => <li key={question}>{question}</li>)}</ul>
          {answerAction}
        </div>
      ) : <ul className="mt-1 grid list-disc gap-2 pl-5 text-pretty text-foreground">
        {questions.map((question) => <li key={question}>{question}</li>)}
      </ul>)}
    </div>
  )
}
