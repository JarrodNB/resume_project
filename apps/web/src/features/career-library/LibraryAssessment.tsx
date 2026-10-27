/** Shows a review grade, explanation, and up to three questions about missing evidence.
 * Outdated feedback loses its grade so it cannot look like current advice.
 * An optional action sits beside the grade, leaving its questions at the full text width.
 * When the questions can be answered, they sit in a red "needs you" box with the answer button,
 * so a question waiting on the user is hard to miss.
 */
import type { ReactNode } from 'react'
import { CircleCheck, CircleDashed, CircleAlert, CircleHelp, RotateCcw } from 'lucide-react'

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

const grades: Record<string, { label: string; className: string }> = {
  red: { label: 'Needs work', className: 'text-signal-action-text' },
  yellow: { label: 'Could improve', className: 'text-foreground' },
  green: { label: 'Looks good', className: 'text-signal-done-text' },
}

export function LibraryAssessment({ assessment, compact = false, action, answerAction }: { assessment?: Assessment; compact?: boolean; action?: ReactNode; answerAction?: ReactNode }) {
  const grade = assessment && !assessment.stale ? grades[assessment.color] : null
  const questions = assessment?.questions ?? (assessment?.question ? [assessment.question] : [])
  const Icon = !grade ? (assessment?.stale ? RotateCcw : CircleDashed) : assessment?.color === 'green' ? CircleCheck : assessment?.color === 'red' ? CircleAlert : CircleHelp
  return (
    <div className="library-assessment grid gap-1 py-2 text-sm leading-relaxed">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className={`inline-flex items-center gap-2 font-medium ${grade?.className ?? 'text-muted-foreground'}`}>
          <Icon aria-hidden="true" className="size-4 shrink-0" />
          {grade?.label ?? (assessment?.stale ? 'Needs review' : 'Not reviewed')}
        </span>
        {action}
      </div>
      {!compact && grade && assessment?.reason && <p className="max-w-prose text-pretty text-muted-foreground">{assessment.reason}</p>}
      {grade && questions.length > 0 && (answerAction ? (
        <div className="review-questions">
          <p className="review-questions-title"><span className="signal-dot is-action" aria-hidden />{questions.length > 1 ? `The review has ${questions.length} questions for you` : 'The review has a question for you'}</p>
          <ul>{questions.map((question) => <li key={question}>{question}</li>)}</ul>
          {answerAction}
        </div>
      ) : <ul className={`mt-2 grid max-w-prose list-disc gap-2 pl-5 text-sm text-pretty ${compact ? 'text-muted-foreground' : 'font-medium'}`}>
        {questions.map((question) => <li key={question}>{question}</li>)}
      </ul>)}
    </div>
  )
}
