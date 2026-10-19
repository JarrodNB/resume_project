/** Search shared US listings on demand, then open a personal saved Job.
 * Fetching, pagination, and imports live in hooks; descriptions are rendered as text.
 */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowUpRight, Search } from 'lucide-react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { PageHeading } from '@/components/PageHeading'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { JobBoardListingRow } from './JobBoardListingRow'
import { useImportJobBoardListing } from './useImportJobBoardListing'
import { useJobBoardSearch } from './useJobBoardSearch'

export function JobBoardPage() {
  const [keyword, setKeyword] = useState('')
  const [remoteOnly, setRemoteOnly] = useState(false)
  const board = useJobBoardSearch()
  const importer = useImportJobBoardListing()
  const navigate = useNavigate()

  async function createJob(listingId: string) {
    const result = await importer.save(listingId)
    if (result) navigate(`/jobs/${result.jobId}`, { state: { jobBoardImport: result } })
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <PageHeading title="Job Board" description="Search US-based opportunities. Save the ones you want to pursue to your private Jobs." actions={
        <Button asChild variant="outline"><Link to="/jobs">Your saved jobs <ArrowUpRight aria-hidden /></Link></Button>
      } />
      <form aria-label="Find jobs" onSubmit={(event) => { event.preventDefault(); board.search(keyword, remoteOnly) }} className="grid gap-4 border-b pb-6">
        <div className="grid gap-2">
          <Label htmlFor="job-board-keyword">Keyword or job title</Label>
          <Input id="job-board-keyword" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="e.g. Software engineer" maxLength={200} className="min-h-11" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <Label className="min-h-11"><Checkbox checked={remoteOnly} onCheckedChange={(checked) => setRemoteOnly(checked === true)} />Remote only</Label>
          <Button type="submit" disabled={!keyword.trim()}><Search aria-hidden /> Search jobs</Button>
        </div>
      </form>
      {!board.hasSearched && <div className="empty-records"><Search size={30} strokeWidth={1.4} aria-hidden /><p>Enter a keyword to find US-based opportunities.</p></div>}
      {board.loading && <p role="status" className="text-sm text-muted-foreground">Loading jobs…</p>}
      {board.errors.length > 0 && <div className="grid gap-2">
        <ErrorAlert title="Couldn't load jobs" messages={board.errors} />
        <Button variant="outline" className="justify-self-start" onClick={() => board.retry()} disabled={board.loading}>Try again</Button>
      </div>}
      {board.pages.map((page, index) => (
        <div key={page.cursor ?? 'first'} className="grid gap-2 text-sm text-muted-foreground">
          <p>{index > 0 && `Page ${index + 1} · `}{page.stale && 'Showing older results · '}Retrieved <time dateTime={page.retrievedAt}>{new Date(page.retrievedAt).toLocaleString()}</time></p>
          {page.stale && <>
            <ErrorAlert title="Couldn't refresh these results" messages={page.errors} />
            <Button variant="outline" className="justify-self-start" disabled={board.loading} onClick={() => board.retry(page.cursor)}>Retry results</Button>
          </>}
        </div>
      ))}
      {!board.loading && board.pages.length > 0 && board.listings.length === 0 && <p className="text-muted-foreground">No matches. Try another keyword or turn off Remote only.</p>}
      <ErrorAlert title="Couldn't create this job" messages={importer.errors} />
      {board.listings.length > 0 && <ul aria-label="Job listings" className="min-w-0">
        {board.listings.map((listing) => <JobBoardListingRow key={listing.id} listing={listing} busyId={importer.busyId} onCreate={(id) => void createJob(id)} />)}
      </ul>}
      {board.nextCursor && <Button variant="outline" disabled={board.loading} onClick={board.loadMore} className="justify-self-start">Load more</Button>}
    </div>
  )
}
