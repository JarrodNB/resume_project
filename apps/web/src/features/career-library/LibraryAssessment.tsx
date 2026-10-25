/** Shows a review grade, explanation, and up to three questions about missing evidence.
 * Outdated feedback loses its grade so it cannot look like current advice.
 */
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
  red: { label: 'Needs work', className: 'text-red-700 dark:text-red-300' },
  yellow: { label: 'Could improve', className: 'text-amber-800 dark:text-amber-300' },
  green: { label: 'Looks good', className: 'text-green-800 dark:text-green-300' },
}

export function LibraryAssessment({ assessment, compact = false }: { assessment?: Assessment; compact?: boolean }) {
  const grade = assessment && !assessment.stale ? grades[assessment.color] : null
  const questions = assessment?.questions ?? (assessment?.question ? [assessment.question] : [])
  const Icon = !grade ? (assessment?.stale ? RotateCcw : CircleDashed) : assessment?.color === 'green' ? CircleCheck : assessment?.color === 'red' ? CircleAlert : CircleHelp
  return (
    <div className="library-assessment grid gap-1 py-2 text-sm leading-relaxed">
      <span className={`inline-flex items-center gap-2 font-medium ${grade?.className ?? 'text-muted-foreground'}`}>
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        {grade?.label ?? (assessment?.stale ? 'Needs review' : 'Not reviewed')}
      </span>
      {!compact && grade && assessment?.reason && <p className="max-w-prose text-pretty text-muted-foreground">{assessment.reason}</p>}
      {grade && questions.map((question) => <p key={question} className="max-w-prose text-pretty font-medium">{question}</p>)}
    </div>
  )
}
