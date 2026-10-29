/** Present an opportunity and preview its plain-text details without leaving results.
 * Both save controls use the current visit's import lock and owner-scoped feedback.
 */
import { PreferenceAssessment } from './PreferenceAssessment'
import type { ListingAssessment } from './preferenceAssessments'
import type { JobPreferencesQuery } from '@/graphql/generated/graphql'
import { Link } from 'react-router'
import { ArrowUpRight, Check, MapPin, Plus, Radio } from 'lucide-react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { FormattedDescription } from '@/components/FormattedDescription'
import { Button } from '@/components/ui/button'
import { employmentTypeOptions, remoteOptions } from './searchFilters'
import type { BoardListing } from './useJobBoardSearch'

interface Props {
  assessment?: ListingAssessment & { profile: JobPreferencesQuery['jobPreferences'] }
  listing: BoardListing
  busyId: string | null
  /** Set once this listing was saved from the board, so the row can link to the new job. */
  savedHere?: { jobId: string; warnings: string[] }
  errors: string[]
  onCreate: (listingId: string) => void
}

export function JobBoardListingRow({ listing, busyId, savedHere, errors, onCreate, assessment }: Props) {
  const published = listing.published ? new Date(listing.published) : null
  const remoteLabel = remoteOptions.find(([value]) => value === listing.remoteType)?.[1] ?? 'Remote option'
  const employmentLabel = employmentTypeOptions.find(([value]) => value === listing.employmentType)?.[1]
  const metadata = (listing.location || listing.hasRemote || employmentLabel || listing.salaryText || (published && !Number.isNaN(published.getTime()))) && (
    <div className="board-listing-meta">
      {listing.location && <span><MapPin size={14} aria-hidden />{listing.location}</span>}
      {listing.hasRemote && <span className="board-remote-tag"><Radio size={13} aria-hidden />{remoteLabel}</span>}
      {employmentLabel && <span>{employmentLabel}</span>}
      {listing.salaryText && <span>{listing.salaryText}{listing.salaryCurrency && ` · ${listing.salaryCurrency}`}</span>}
      {published && !Number.isNaN(published.getTime()) && <span>Posted <time dateTime={listing.published!}>{published.toLocaleDateString()}</time></span>}
    </div>
  )
  const sourceUrl = originalPostingUrl(listing.applicationUrl)
  const action = listing.savedJob ? (
    <Button asChild variant="outline" className="board-listing-action"><Link to={`/jobs/${listing.savedJob.id}`}>Open saved job <ArrowUpRight aria-hidden /></Link></Button>
  ) : savedHere ? (
    <div className="board-listing-saved">
      <p role="status"><Check size={14} aria-hidden />{savedHere.warnings.length ? 'Saved with a few changes' : 'Saved to your jobs'}</p>
      <Button asChild variant="outline" className="board-listing-action"><Link to={`/jobs/${savedHere.jobId}`} state={{ jobBoardImport: savedHere }}>Open saved job <ArrowUpRight aria-hidden /></Link></Button>
    </div>
  ) : (
    <Button variant="outline" className="board-listing-action" disabled={busyId !== null} onClick={() => onCreate(listing.id)}><Plus aria-hidden />{busyId === listing.id ? 'Saving…' : 'Save job'}</Button>
  )
  return (
    <li className="board-listing" data-saved={Boolean(listing.savedJob)}>
      <Dialog><article aria-labelledby={`listing-${listing.id}`}>
        <div className="board-listing-header">
          <div className="board-listing-identity">
            <h2 id={`listing-${listing.id}`} className="board-listing-title"><DialogTrigger asChild><button type="button" className="board-preview-trigger">{listing.title}</button></DialogTrigger></h2>
            <p className="board-listing-company">{listing.company ?? 'Unknown company'}</p>
            {metadata}
          </div>
          {action}
        </div>
        {assessment && <PreferenceAssessment listing={listing} {...assessment} />}
      </article>
      <DialogContent className="board-preview" aria-describedby={`preview-company-${listing.id}`}>
        <div className="board-preview-heading">
          <DialogTitle className="board-preview-title">{listing.title}</DialogTitle>
          <DialogDescription id={`preview-company-${listing.id}`}>{listing.company ?? 'Unknown company'}{listing.location && ` · ${listing.location}`}</DialogDescription>
        </div>
        {metadata}
        <div className="board-preview-actions">{action}
          {sourceUrl && <Button asChild variant="outline"><a href={sourceUrl} target="_blank" rel="noopener noreferrer">View original posting<ArrowUpRight aria-hidden /></a></Button>}
        </div>
        <ErrorAlert title="Couldn't create this job" messages={errors} />
        {savedHere && savedHere.warnings.length > 0 && <div role="status" className="board-preview-warnings"><p>Saved with a few changes:</p><ul>{savedHere.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
        <div className="board-preview-description">
          <h3>Description</h3>
          {listing.description ? <FormattedDescription className="board-description" text={listing.description} /> : <p className="board-description-missing">No description provided.</p>}
        </div>
      </DialogContent></Dialog>
    </li>
  )
}

/** Only absolute web links without embedded credentials can leave the app. */
function originalPostingUrl(value: string | null) {
  if (!value) return null
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}
