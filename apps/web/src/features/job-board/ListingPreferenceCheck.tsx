/** Show one listing's criterion decisions with exact posting excerpts and honest unknowns. */
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { useListingPreferenceCheck } from './useListingPreferenceCheck'
import type { BoardListing } from './useJobBoardSearch'

const reasons: Record<string, string> = { not_stated: 'The posting does not establish this condition.',
  incomplete_source: 'The available excerpt does not establish this condition; some posting text was omitted.',
  contradictory_evidence: 'The posting contains evidence on both sides of this condition.' }

export function ListingPreferenceCheck({ listing, scope }: { listing: BoardListing; scope: object }) {
  const check = useListingPreferenceCheck(listing, scope)
  return <div className="grid gap-3 border-t pt-3">
    <Button type="button" variant="outline" className="justify-self-start" disabled={check.busy || !listing.preferenceSourceDigest} onClick={() => void check.check()} aria-label={`Check preferences for ${listing.title}`}>{check.busy ? 'Checking preferences…' : 'Check preferences'}</Button>
    <ErrorAlert title="Couldn't check preferences" messages={check.error ? [check.error] : []} />
    {check.disconnected && <p role="status">Check updates disconnected. Reconnect or check again to recover the result.</p>}
    {check.stale && <p role="status">These results or confirmed preferences changed. Check again for a current assessment.</p>}
    {check.decisions && <div aria-label={`Preference assessment for ${listing.title}`} className="grid gap-3">
      <p>Checked against your confirmed preferences.</p>
      {check.decisions.map((decision) => {
        const criterion = check.profile?.confirmedCriteria.find((value) => value.id === decision.id)
        return <div key={decision.id} className="grid gap-1">
          <p><strong>{decision.status === 'matching' ? 'Matching' : decision.status === 'conflicting' ? 'Conflicting' : 'Unknown'}</strong> · {criterion?.priority === 'must_have' ? 'Must-have' : 'Nice-to-have'}: {criterion?.text}</p>
          {reasons[decision.reason] && <p>{reasons[decision.reason]}</p>}
          {decision.support && <blockquote className="border-l-2 pl-3">Supports: {decision.support.text}</blockquote>}
          {decision.contradiction && <blockquote className="border-l-2 pl-3">Conflicts: {decision.contradiction.text}</blockquote>}
        </div>
      })}
    </div>}
  </div>
}
