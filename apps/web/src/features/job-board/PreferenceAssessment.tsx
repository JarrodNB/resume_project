/** Show accepted preference decisions and exact posting excerpts without row-level requests. */
import type { BoardListing } from './jobBoardVisit'
import type { CriterionDecision } from './preferenceAssessments'
import type { JobPreferencesQuery } from '@/graphql/generated/graphql'
import { CollapseToggle } from '@/components/CollapseToggle'
import { useOpenSection } from '@/components/useOpenSection'

const reasons: Record<string, string> = { not_stated: 'The posting does not establish this condition.',
  incomplete_source: 'The available excerpt does not establish this condition; some posting text was omitted.',
  contradictory_evidence: 'The posting contains evidence on both sides of this condition.' }

/** Render already accepted exact evidence without starting requests or creating row subscriptions. */
export function PreferenceAssessment({ listing, decisions, profile, truncated }: { listing: BoardListing; decisions: CriterionDecision[]; profile: JobPreferencesQuery['jobPreferences']; truncated: boolean }) {
  const { open, toggle, panelId } = useOpenSection(`job-board:${listing.id}:preferences`)
  return <div aria-label={`Preference assessment for ${listing.title}`} className="grid gap-3 border-t pt-3">
      <p>Checked against your confirmed preferences.</p>
      {truncated && <p>Checked an excerpt; some posting text was omitted.</p>}
      <p>{decisions.filter((decision) => decision.status === 'matching').length} matching · {decisions.filter((decision) => decision.status === 'conflicting').length} conflicting · {decisions.filter((decision) => decision.status === 'unknown').length} unknown</p>
      <CollapseToggle open={open} panelId={panelId} onToggle={toggle} className="justify-self-start"><span>Preference details <span className="sr-only">for {listing.title}</span></span></CollapseToggle>
      {open && <div id={panelId} className="grid gap-3">{decisions.map((decision) => {
        const criterion = profile.confirmedCriteria.find((value) => value.id === decision.id)
        return <div key={decision.id} className="grid gap-1">
          <p><strong>{decision.status === 'matching' ? 'Matching' : decision.status === 'conflicting' ? 'Conflicting' : 'Unknown'}</strong> · {criterion?.priority === 'must_have' ? 'Must-have' : 'Nice-to-have'}: {criterion?.text}</p>
          {reasons[decision.reason] && <p>{reasons[decision.reason]}</p>}
          {decision.support && <blockquote className="border-l-2 pl-3">Supports: {decision.support.text}</blockquote>}
          {decision.contradiction && <blockquote className="border-l-2 pl-3">Conflicts: {decision.contradiction.text}</blockquote>}
        </div>
      })}</div>}
    </div>
}
