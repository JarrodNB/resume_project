/** Present one opportunity with scannable details and a private save/open action.
 * Descriptions remain plain text, shown with their labels and bullets, and remember
 * whether the user has expanded them.
 */
import { Link } from 'react-router'
import { ArrowUpRight, MapPin, Plus, Radio } from 'lucide-react'
import { CollapseToggle } from '@/components/CollapseToggle'
import { FormattedDescription } from '@/components/FormattedDescription'
import { useOpenSection } from '@/components/useOpenSection'
import { Button } from '@/components/ui/button'
import { employmentTypeOptions, remoteOptions } from './searchFilters'
import type { BoardListing } from './useJobBoardSearch'

interface Props {
  listing: BoardListing
  busyId: string | null
  onCreate: (listingId: string) => void
}

export function JobBoardListingRow({ listing, busyId, onCreate }: Props) {
  const { open, toggle, panelId } = useOpenSection(`job-board:${listing.id}:description`)
  const published = listing.published ? new Date(listing.published) : null
  const remoteLabel = remoteOptions.find(([value]) => value === listing.remoteType)?.[1] ?? 'Remote option'
  const employmentLabel = employmentTypeOptions.find(([value]) => value === listing.employmentType)?.[1]
  return (
    <li className="board-listing" data-saved={Boolean(listing.savedJob)}>
      <article aria-labelledby={`listing-${listing.id}`}>
        <div className="board-listing-header">
          <div className="board-listing-identity">
            <h2 id={`listing-${listing.id}`} className="board-listing-title">{listing.title}</h2>
            <p className="board-listing-company">{listing.company ?? 'Unknown company'}</p>
            {(listing.location || listing.hasRemote || employmentLabel || listing.salaryText || (published && !Number.isNaN(published.getTime()))) && <div className="board-listing-meta">
              {listing.location && <span><MapPin size={14} aria-hidden />{listing.location}</span>}
              {listing.hasRemote && <span className="board-remote-tag"><Radio size={13} aria-hidden />{remoteLabel}</span>}
              {employmentLabel && <span>{employmentLabel}</span>}
              {listing.salaryText && <span>{listing.salaryText}{listing.salaryCurrency && ` · ${listing.salaryCurrency}`}</span>}
              {published && !Number.isNaN(published.getTime()) && <span>Posted <time dateTime={listing.published!}>{published.toLocaleDateString()}</time></span>}
            </div>}
          </div>
          {listing.savedJob ? (
            <Button asChild variant="outline" className="board-listing-action"><Link to={`/jobs/${listing.savedJob.id}`}>Open saved job <ArrowUpRight aria-hidden /></Link></Button>
          ) : (
            <Button variant="outline" className="board-listing-action" disabled={busyId !== null} onClick={() => onCreate(listing.id)}><Plus aria-hidden />{busyId === listing.id ? 'Creating…' : 'Create job'}</Button>
          )}
        </div>
        {listing.description ? <>
          <CollapseToggle open={open} panelId={panelId} onToggle={toggle} className="board-description-toggle">
            <span>Description <span className="sr-only">for {listing.title}</span></span>
          </CollapseToggle>
          {open && <FormattedDescription id={panelId} className="board-description" text={listing.description} />}
        </> : <p className="board-description-missing">No description provided.</p>}
      </article>
    </li>
  )
}
