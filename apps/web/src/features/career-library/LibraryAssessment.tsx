/** A small text-labeled traffic light; outdated colors never look like current advice. */
export interface Assessment {
  kind: string
  recordId: string
  field: string
  color: string
  reason: string
  stale: boolean
}

const grades: Record<string, { label: string; className: string }> = {
  red: { label: 'Needs work', className: 'text-red-700 dark:text-red-300' },
  yellow: { label: 'Could improve', className: 'text-amber-800 dark:text-amber-300' },
  green: { label: 'Looks good', className: 'text-green-800 dark:text-green-300' },
}

export function LibraryAssessment({ assessment }: { assessment?: Assessment }) {
  const grade = assessment && !assessment.stale ? grades[assessment.color] : null
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
      <span className={`inline-flex items-center gap-1.5 ${grade?.className ?? 'text-muted-foreground'}`}>
        {grade && <span aria-hidden="true" className="size-2 rounded-full bg-current" />}
        {grade?.label ?? (assessment?.stale ? 'Needs review' : 'Not reviewed')}
      </span>
      {grade && <span className="text-muted-foreground">{assessment?.reason}</span>}
    </div>
  )
}
