/** One opportunity with a private save/open action and a remembered text-only description. */
import { Link } from 'react-router'
import { ArrowUpRight } from 'lucide-react'
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
    <li className="border-t py-6 first:border-t-0">
      <article aria-labelledby={`listing-${listing.id}`} className="grid min-w-0 gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 basis-56">
            <h2 id={`listing-${listing.id}`} className="text-lg font-medium break-words">{listing.title}</h2>
            <p className="text-sm text-muted-foreground break-words">{[listing.company ?? 'Unknown company', listing.location].filter(Boolean).join(' · ')}</p>
            {listing.hasRemote && <p className="mt-1 text-sm text-muted-foreground">Remote option</p>}
          </div>
          {listing.savedJob ? (
            <Button asChild variant="outline"><Link to={`/jobs/${listing.savedJob.id}`}>Open saved job <ArrowUpRight aria-hidden /></Link></Button>
          ) : (
            <Button disabled={busyId !== null} onClick={() => onCreate(listing.id)}>{busyId === listing.id ? 'Creating…' : 'Create job'}</Button>
          )}
        </div>
        {listing.description ? (
          <div className="grid gap-3">
            <CollapseToggle open={open} panelId={panelId} onToggle={toggle} className="min-h-11 text-sm text-muted-foreground">
              <span>Description <span className="sr-only">for {listing.title}</span></span>
            </CollapseToggle>
            {open && <div id={panelId} className="max-w-prose whitespace-pre-wrap text-sm leading-relaxed break-words">{listing.description}</div>}
          </div>
        ) : <p className="text-sm text-muted-foreground">No description provided.</p>}
      </article>
    </li>
  )
}
