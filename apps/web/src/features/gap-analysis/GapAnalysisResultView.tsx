/**
 * A finished comparison on the Fit tab: the summary, then requirements grouped by what needs the
 * user, starting with gaps to fill. Saving or dismissing moves a row to another group, which removes
 * the button that was pressed, so keyboard focus returns to the top of the results.
 */
import { useRef, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { groupAssessments } from './groupAssessments'
import { CollapsedRequirementRow, DismissedRequirementRow, OpenRequirementRow } from './RequirementAssessmentItem'
import type { AssessedRequirement, GapAnalysisResult } from './parseGapAnalysisResult'
import type { SavedGapResponse } from './savedGapResponse'

/** Shows the summary and every assessed requirement in its group. */
export function GapAnalysisResultView({
  jobId,
  analysis,
  responses,
  dismissedRequirements,
  comparedNote,
}: {
  jobId: string
  analysis: GapAnalysisResult
  responses: SavedGapResponse[]
  dismissedRequirements: string[]
  comparedNote: ReactNode
}) {
  const resultsRef = useRef<HTMLDivElement>(null)
  const groups = groupAssessments(analysis.assessments, responses.map((item) => item.requirement), dismissedRequirements)
  const responseFor = (assessment: AssessedRequirement) => responses.find((item) => item.requirement === assessment.requirement) ?? null
  const onMoved = () => resultsRef.current?.focus({ preventScroll: true })
  const rowProps = (assessment: AssessedRequirement) => ({ jobId, assessment, response: responseFor(assessment), onMoved })

  return (
    <div ref={resultsRef} tabIndex={-1} className="grid gap-7 outline-none">
      <div className="grid gap-2">
        {analysis.warnings.map((warning) => (
          <p key={warning} className="text-sm text-muted-foreground">
            {warning}
          </p>
        ))}
        {analysis.summary && <p className="max-w-[65ch]">{analysis.summary}</p>}
        {comparedNote}
        {(groups.gaps.length > 0 || groups.couldBeStronger.length > 0) && (
          <p className="max-w-[65ch] text-sm text-muted-foreground">
            Add real details so your tailored resume can cover these, or dismiss anything you can't or don't want to answer.
          </p>
        )}
      </div>
      <RequirementGroup title="Gaps to fill" count={`${groups.gaps.length} ${groups.gaps.length === 1 ? 'gap' : 'gaps'}`} countClass="border-signal-action text-signal-action-text" empty={groups.gaps.length === 0}>
        {groups.gaps.map((assessment) => <OpenRequirementRow key={assessment.requirement} {...rowProps(assessment)} />)}
      </RequirementGroup>
      <RequirementGroup title="Could be stronger" count={`${groups.couldBeStronger.length} partly met`} countClass="border-foreground text-foreground" empty={groups.couldBeStronger.length === 0}>
        {groups.couldBeStronger.map((assessment) => <OpenRequirementRow key={assessment.requirement} {...rowProps(assessment)} />)}
      </RequirementGroup>
      <RequirementGroup title="Answered" count={`${groups.answered.length} answered`} countClass="border-foreground text-foreground" empty={groups.answered.length === 0}>
        {groups.answered.map((assessment) => <OpenRequirementRow key={assessment.requirement} {...rowProps(assessment)} />)}
      </RequirementGroup>
      <RequirementGroup title="Met" count={`${groups.met.length} met`} countClass="border-signal-done text-signal-done-text" empty={groups.met.length === 0}>
        {groups.met.map((assessment) => <CollapsedRequirementRow key={assessment.requirement} {...rowProps(assessment)} />)}
      </RequirementGroup>
      <RequirementGroup title="Nice to have" empty={groups.niceToHave.length === 0}>
        {groups.niceToHave.map((assessment) => <CollapsedRequirementRow key={assessment.requirement} {...rowProps(assessment)} />)}
      </RequirementGroup>
      <RequirementGroup title="Dismissed" empty={groups.dismissed.length === 0}>
        {groups.dismissed.map((assessment) => <DismissedRequirementRow key={assessment.requirement} jobId={jobId} assessment={assessment} onMoved={onMoved} />)}
      </RequirementGroup>
    </div>
  )
}

/** A titled group of rows on an ink rule; nothing when empty. */
function RequirementGroup({
  title,
  count,
  countClass,
  empty,
  children,
}: {
  title: string
  count?: string
  countClass?: string
  empty: boolean
  children: ReactNode
}) {
  if (empty) return null
  return (
    <section>
      <h3 className="flex items-center gap-2 border-b-2 border-foreground pb-2.5 text-base leading-tight font-bold">
        {title}
        {count && <Badge variant="outline" className={cn(countClass)}>{count}</Badge>}
      </h3>
      <ul>{children}</ul>
    </section>
  )
}
