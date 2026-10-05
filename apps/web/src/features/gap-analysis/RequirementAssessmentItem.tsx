/**
 * Description: One requirement of a gap analysis: verdict badge, the requirement, the AI's
 * explanation, and the career library entries cited as evidence (copied from the library).
 * Profile-summary evidence is left out: it is the whole biography, and citing it repeats that
 * paragraph under every requirement it mentions.
 * A gap or partial match also has a response form, as does a requirement that already has one.
 * The explanation, evidence, and form start collapsed; the form stays mounted so an unsaved
 * answer is kept.
 * Index:
 *   - VerdictBadge: colored badge for a verdict
 *   - RequirementAssessmentItem: list item component
 */
import { CircleCheck, CircleDashed, CircleX } from 'lucide-react'
import { CollapseToggle } from '@/components/CollapseToggle'
import { useOpenSection } from '@/components/useOpenSection'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { GapResponseForm } from './GapResponseForm'
import { VERDICT_LABELS, type AssessedRequirement, type Verdict } from './parseGapAnalysisResult'
import type { SavedGapResponse } from './savedGapResponse'

const VERDICT_STYLES: Record<Verdict, string> = {
  met: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  partial: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  missing: 'bg-destructive/10 text-destructive dark:bg-destructive/20',
}

const VERDICT_ICONS = { met: CircleCheck, partial: CircleDashed, missing: CircleX }

/** A small colored badge naming the verdict. */
export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const Icon = VERDICT_ICONS[verdict]
  return (
    <Badge className={cn('shrink-0', VERDICT_STYLES[verdict])}>
      <Icon data-icon="inline-start" />
      {VERDICT_LABELS[verdict]}
    </Badge>
  )
}

/** Renders one assessed requirement with its evidence and, for a gap or partial match, a response. */
export function RequirementAssessmentItem({
  jobId,
  assessment,
  response,
}: {
  jobId: string
  assessment: AssessedRequirement
  response: SavedGapResponse | null
}) {
  const { open, toggle, panelId } = useOpenSection(`job.${jobId}.gap.${assessment.requirement}`)
  const showResponse = assessment.verdict !== 'met' || response !== null
  const evidence = assessment.evidence.filter((item) => item.kind !== 'summary')
  return (
    <li className="grid gap-2 py-3">
      <CollapseToggle open={open} panelId={panelId} onToggle={toggle} className="items-start">
        <span className="flex min-w-0 flex-1 items-start justify-between gap-3">
          <span className="font-medium">{assessment.requirement}</span>
          <VerdictBadge verdict={assessment.verdict} />
        </span>
      </CollapseToggle>
      <div id={panelId} hidden={!open} className={open ? 'grid gap-2' : undefined}>
        {assessment.explanation && <p className="text-sm text-muted-foreground">{assessment.explanation}</p>}
        {evidence.length > 0 && (
          <ul className="grid gap-1 border-l-2 pl-3 text-sm" aria-label="Evidence from your career library">
            {evidence.map((item, index) => (
              <li key={item.id ?? `${item.kind}-${index}`}>
                {item.text}
                {item.context && <span className="text-muted-foreground"> · {item.context}</span>}
              </li>
            ))}
          </ul>
        )}
        {showResponse && <GapResponseForm jobId={jobId} requirement={assessment.requirement} response={response} />}
      </div>
    </li>
  )
}
