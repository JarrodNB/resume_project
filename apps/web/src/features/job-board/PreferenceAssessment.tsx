/** Present independent model-estimated preference probabilities without extra row requests. */
import type { BoardListing } from './jobBoardVisit'
import type { CriterionDecision } from './preferenceAssessments'
import type { JobPreferencesQuery } from '@/graphql/generated/graphql'
import { CollapseToggle } from '@/components/CollapseToggle'
import { useOpenSection } from '@/components/useOpenSection'

/** Show accepted estimates, not evidence claims or calibrated real-world guarantees. */
export function PreferenceAssessment({ listing, decisions, profile, truncated }: { listing: BoardListing; decisions: CriterionDecision[]; profile: JobPreferencesQuery['jobPreferences']; truncated: boolean }) {
  const { open, toggle, panelId } = useOpenSection(`job-board:${listing.id}:preferences`)
  const mean = (priority: string) => {
    const group = decisions.filter((decision) => profile.confirmedCriteria.find((criterion) => criterion.id === decision.id)?.priority === priority)
    return group.length ? `${Math.round(group.reduce((sum, item) => sum + item.probability, 0) / group.length * 100)}%` : null
  }
  const must = mean('must_have')
  const nice = mean('nice_to_have')
  return <div aria-label={`Preference assessment for ${listing.title}`} className="grid gap-3 border-t pt-3">
    <p>Estimated preference fit</p>
    <p>{[must && `Must-have average: ${must}`, nice && `Nice-to-have average: ${nice}`].filter(Boolean).join(' · ')}</p>
    {truncated && <p>Checked an excerpt; some posting text was omitted.</p>}
    <CollapseToggle open={open} panelId={panelId} onToggle={toggle} className="justify-self-start"><span>Preference details <span className="sr-only">for {listing.title}</span></span></CollapseToggle>
    {open && <div id={panelId} className="grid gap-3">
      {decisions.map((decision) => {
        const criterion = profile.confirmedCriteria.find((value) => value.id === decision.id)
        return <div key={decision.id} className="grid gap-1">
          <p><strong>{Math.round(decision.probability * 100)}% estimated fit</strong> · {criterion?.priority === 'must_have' ? 'Must-have' : 'Nice-to-have'}: {criterion?.text}</p>
        </div>
      })}
    </div>}
  </div>
}
