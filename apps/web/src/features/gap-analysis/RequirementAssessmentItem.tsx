/**
 * One requirement of a comparison, drawn three ways depending on its group on the Fit tab.
 *
 * Open rows (gaps, could be stronger, answered) show the AI's reason, the library evidence and the
 * way to respond without a click. Collapsed rows (met, nice to have) start closed to keep the page
 * short; their form stays mounted so unsaved text survives closing the row. Dismissed rows offer
 * Restore. Profile-summary evidence is left out: it is the whole biography, and citing it repeats
 * that paragraph under every requirement it mentions.
 */
import { CircleCheck, CircleDashed, CircleX } from 'lucide-react'
import { useState } from 'react'
import { CollapseToggle } from '@/components/CollapseToggle'
import { ErrorAlert } from '@/components/ErrorAlert'
import { useOpenSection } from '@/components/useOpenSection'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { GapResponseForm } from './GapResponseForm'
import { VERDICT_LABELS, type AssessedRequirement, type Verdict } from './parseGapAnalysisResult'
import type { SavedGapResponse } from './savedGapResponse'
import { useSetGapDismissal } from './useSetGapDismissal'

const VERDICT_STYLES: Record<Verdict, string> = {
  met: 'border-signal-done text-signal-done-text',
  partial: 'border-foreground text-foreground',
  missing: 'border-signal-action text-signal-action-text',
}

const VERDICT_ICONS = { met: CircleCheck, partial: CircleDashed, missing: CircleX }

/** Names the verdict. Quiet drops the signal color when the requirement doesn't need the user. */
export function VerdictBadge({ verdict, quiet = false }: { verdict: Verdict; quiet?: boolean }) {
  const Icon = VERDICT_ICONS[verdict]
  return (
    <Badge variant="outline" className={cn('shrink-0', quiet ? 'border-input text-muted-foreground' : VERDICT_STYLES[verdict])}>
      <Icon data-icon="inline-start" />
      {VERDICT_LABELS[verdict]}
    </Badge>
  )
}

interface RowProps {
  jobId: string
  assessment: AssessedRequirement
  response: SavedGapResponse | null
  onMoved: () => void
}

/** The AI's reason and the library entries it cited. */
function RequirementFindings({ assessment }: { assessment: AssessedRequirement }) {
  const evidence = assessment.evidence.filter((item) => item.kind !== 'summary')
  return (
    <div className="grid content-start gap-3">
      {assessment.explanation && <p className="text-sm text-muted-foreground">{assessment.explanation}</p>}
      {evidence.length > 0 && (
        <ul className="grid gap-2 text-sm" aria-label="Evidence from your career library">
          {evidence.map((item, index) => (
            <li key={item.id ?? `${item.kind}-${index}`}>
              {item.text}
              {item.context && <span className="block text-[13px] text-muted-foreground">{item.context}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Dismisses the requirement and tells the list it moved. */
function DismissButton({ jobId, requirement, onMoved }: { jobId: string; requirement: string; onMoved: () => void }) {
  const { setDismissed, busy, errors } = useSetGapDismissal(jobId, requirement)
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={busy}
        aria-label={`Dismiss ${requirement}`}
        onClick={() => void setDismissed(true).then((done) => done && onMoved())}
      >
        Dismiss
      </Button>
      <ErrorAlert title="Couldn't dismiss this" messages={errors} />
    </>
  )
}

/** A gap, a partial match or an answered requirement, with everything visible. */
export function OpenRequirementRow({ jobId, assessment, response, onMoved }: RowProps) {
  const { requirement, verdict } = assessment
  const [composing, setComposing] = useState(false)
  const dismiss = <DismissButton jobId={jobId} requirement={requirement} onMoved={onMoved} />
  const showForm = composing || (verdict === 'missing' && !response)

  return (
    <li className="grid gap-3 border-b py-4">
      <div className="flex items-start justify-between gap-4 font-bold">
        <span className="min-w-0 break-words">{requirement}</span>
        <VerdictBadge verdict={verdict} quiet={verdict === 'missing' && response !== null} />
      </div>
      <div className="grid gap-4 md:grid-cols-2 md:gap-6">
        <RequirementFindings assessment={assessment} />
        <div className="grid content-start gap-3">
          {showForm && (
            <GapResponseForm
              jobId={jobId}
              requirement={requirement}
              response={response}
              dismissAction={dismiss}
              onSaved={() => {
                setComposing(false)
                onMoved()
              }}
            />
          )}
          {!showForm && response && (
            <>
              <p className="rounded-sm bg-muted px-3 py-2 text-sm whitespace-pre-line">{response.body}</p>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" size="sm" variant="outline" aria-label={`Edit details for ${requirement}`} onClick={() => setComposing(true)}>Edit details</Button>
                <span className="text-sm text-muted-foreground">Resume drafts for this job can use this.</span>
              </div>
            </>
          )}
          {!showForm && !response && (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" size="sm" variant="outline" aria-label={`Add details for ${requirement}`} onClick={() => setComposing(true)}>Add details</Button>
              {dismiss}
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

/** A met requirement or a nice-to-have, closed until the user opens it. */
export function CollapsedRequirementRow({ jobId, assessment, response, onMoved }: RowProps) {
  const { requirement, verdict, kind } = assessment
  const { open, toggle, panelId } = useOpenSection(`job.${jobId}.gap.${requirement}`)
  const showResponse = verdict !== 'met' || response !== null
  return (
    <li className="grid gap-3 border-b py-3">
      <CollapseToggle open={open} panelId={panelId} onToggle={toggle} className="items-start">
        <span className="flex min-w-0 flex-1 items-start justify-between gap-3">
          <span className="min-w-0 text-sm font-medium break-words">{requirement}</span>
          <VerdictBadge verdict={verdict} quiet={kind === 'nice_to_have' && verdict === 'missing'} />
        </span>
      </CollapseToggle>
      <div id={panelId} hidden={!open} className={open ? 'grid gap-4 md:grid-cols-2 md:gap-6' : undefined}>
        <RequirementFindings assessment={assessment} />
        {showResponse && (
          <GapResponseForm
            jobId={jobId}
            requirement={requirement}
            response={response}
            dismissAction={verdict !== 'met' && <DismissButton jobId={jobId} requirement={requirement} onMoved={onMoved} />}
            onSaved={onMoved}
          />
        )}
      </div>
    </li>
  )
}

/** A requirement the user chose not to answer. */
export function DismissedRequirementRow({ jobId, assessment, onMoved }: Omit<RowProps, 'response'>) {
  const { requirement, verdict } = assessment
  const { setDismissed, busy, errors } = useSetGapDismissal(jobId, requirement)
  return (
    <li className="grid gap-2 border-b py-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="min-w-0 flex-1 basis-60 break-words text-muted-foreground">{requirement}</span>
        <VerdictBadge verdict={verdict} quiet />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          aria-label={`Restore ${requirement}`}
          onClick={() => void setDismissed(false).then((done) => done && onMoved())}
        >
          Restore
        </Button>
      </div>
      <ErrorAlert title="Couldn't restore this" messages={errors} />
    </li>
  )
}
