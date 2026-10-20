/** Present one opportunity with scannable details and a private save/open action.
 * Descriptions remain plain text and remember whether the user has expanded them.
 */
import { Link } from 'react-router'
import { ArrowUpRight, MapPin, Plus, Radio } from 'lucide-react'
import { CollapseToggle } from '@/components/CollapseToggle'
import { useOpenSection } from '@/components/useOpenSection'
import { Button } from '@/components/ui/button'
import type { BoardListing } from './useJobBoardSearch'

interface Props {
  listing: BoardListing
  busyId: string | null
  onCreate: (listingId: string) => void
}

export function JobBoardListingRow({ listing, busyId, onCreate }: Props) {
  const { open, toggle, panelId } = useOpenSection(`job-board:${listing.id}:description`)
  return (
    <li className="board-listing">
      <article aria-labelledby={`listing-${listing.id}`}>
        <div className="board-listing-header">
          <div className="board-listing-identity">
            <h2 id={`listing-${listing.id}`} className="board-listing-title">{listing.title}</h2>
            <p className="board-listing-company">{listing.company ?? 'Unknown company'}</p>
            {(listing.location || listing.hasRemote) && <div className="board-listing-meta">
              {listing.location && <span><MapPin size={14} aria-hidden />{listing.location}</span>}
              {listing.hasRemote && <span className="board-remote-tag"><Radio size={13} aria-hidden />Remote option</span>}
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
          {open && <div id={panelId} className="board-description">{listing.description}</div>}
        </> : <p className="board-description-missing">No description provided.</p>}
      </article>
    </li>
  )
}
