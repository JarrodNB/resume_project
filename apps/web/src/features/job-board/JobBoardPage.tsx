/** Find shared US opportunities, then save a chosen listing to private Jobs.
 * Search and import hooks own requests; this page keeps draft filters separate from submitted results.
 */
import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowRight, ArrowUpRight, Globe2, Search } from 'lucide-react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { PageHeading } from '@/components/PageHeading'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { JobBoardListingRow } from './JobBoardListingRow'
import { useImportJobBoardListing } from './useImportJobBoardListing'
import { useJobBoardSearch } from './useJobBoardSearch'
import './jobBoard.css'

const searchIdeas = ['Software engineer', 'Product designer', 'Data analyst']

export function JobBoardPage() {
  const [keyword, setKeyword] = useState('')
  const [submittedSearch, setSubmittedSearch] = useState({ keyword: '', remoteOnly: false })
  const [remoteOnly, setRemoteOnly] = useState(false)
  const keywordInput = useRef<HTMLInputElement>(null)
  const board = useJobBoardSearch()
  const importer = useImportJobBoardListing()
  const navigate = useNavigate()

  async function createJob(listingId: string) {
    const result = await importer.save(listingId)
    if (result) navigate(`/jobs/${result.jobId}`, { state: { jobBoardImport: result } })
  }

  return (
    <div className="job-board">
      <PageHeading title="Job Board" description="Find your next opportunity. Save the roles you want to pursue to your private Jobs." actions={
        <Button asChild variant="outline"><Link to="/jobs">Your saved jobs <ArrowUpRight aria-hidden /></Link></Button>
      } />
      <form aria-label="Find jobs" className="board-search" onSubmit={(event) => {
        event.preventDefault()
        if (!keyword.trim()) return
        setSubmittedSearch({ keyword: keyword.trim(), remoteOnly })
        board.search(keyword, remoteOnly)
      }}>
        <Label htmlFor="job-board-keyword">Keyword or job title</Label>
        <div className="board-search-field">
          <div className="board-keyword">
            <Search size={19} strokeWidth={1.7} aria-hidden />
            <Input ref={keywordInput} id="job-board-keyword" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="e.g. Software engineer" maxLength={200} autoComplete="off" />
          </div>
          <Button type="submit" disabled={!keyword.trim()} className="board-search-submit"><Search aria-hidden /> Search jobs</Button>
        </div>
        <div className="board-search-options">
          <Label className="board-remote" data-checked={remoteOnly}>
            <Checkbox checked={remoteOnly} onCheckedChange={(checked) => setRemoteOnly(checked === true)} />Remote only
          </Label>
          <span className="board-region"><Globe2 size={15} aria-hidden />US-based opportunities</span>
        </div>
      </form>

      {!board.hasSearched && <div className="board-introduction">
        <div className="board-introduction-icon"><Search size={27} strokeWidth={1.5} aria-hidden /></div>
        <h2>Find a role worth your next step.</h2>
        <p>Start with a job title or a skill. Explore the details, then save the opportunities you want to pursue.</p>
        <div className="board-search-ideas" aria-label="Search ideas">
          {searchIdeas.map((idea) => <Button key={idea} type="button" variant="outline" onClick={() => { setKeyword(idea); keywordInput.current?.focus() }}>{idea}<ArrowRight size={14} aria-hidden /></Button>)}
        </div>
      </div>}

      {board.hasSearched && <div className="board-results-heading">
        <div><p className="board-results-title">{board.loading && board.listings.length === 0 ? 'Finding opportunities' : 'Search results'}</p><p className="board-results-query">For “{submittedSearch.keyword}”{submittedSearch.remoteOnly && ' · Remote only'}</p></div>
        {board.listings.length > 0 && <span className="board-results-count">{board.listings.length} {board.listings.length === 1 ? 'role' : 'roles'} loaded</span>}
      </div>}
      {board.loading && <div role="status" className="board-loading"><span>Loading jobs…</span>
        {board.listings.length === 0 && <div aria-hidden="true" className="board-skeletons">{[0, 1, 2].map((item) => <div className="board-skeleton" key={item}><span /><span /><span /></div>)}</div>}
      </div>}
      {board.errors.length > 0 && <div className="grid gap-3">
        <ErrorAlert title="Couldn't load jobs" messages={board.errors} />
        <Button variant="outline" className="justify-self-start" onClick={() => board.retry()} disabled={board.loading}>Try again</Button>
      </div>}
      <ErrorAlert title="Couldn't create this job" messages={importer.errors} />
      {!board.loading && board.pages.length > 0 && board.listings.length === 0 && <div className="board-no-results"><Search size={26} strokeWidth={1.4} aria-hidden /><h2>No matching roles this time.</h2><p>No matches. Try another keyword or turn off Remote only.</p></div>}
      {board.listings.length > 0 && <ul aria-label="Job listings" className="board-listings">
        {board.listings.map((listing) => <JobBoardListingRow key={listing.id} listing={listing} busyId={importer.busyId} onCreate={(id) => void createJob(id)} />)}
      </ul>}
      {board.pages.length > 0 && <div className="board-results-footer">
        {board.nextCursor && <Button variant="outline" disabled={board.loading} onClick={board.loadMore}>Load more</Button>}
        <div className="board-retrieval">{board.pages.map((page, index) => <div key={page.cursor ?? 'first'} className="grid gap-2">
          <p>{index > 0 && `Page ${index + 1} · `}{page.stale && 'Showing older results · '}Retrieved <time dateTime={page.retrievedAt}>{new Date(page.retrievedAt).toLocaleString()}</time></p>
          {page.stale && <><ErrorAlert title="Couldn't refresh these results" messages={page.errors} /><Button variant="outline" className="justify-self-start" disabled={board.loading} onClick={() => board.retry(page.cursor)}>Retry results</Button></>}
        </div>)}</div>
      </div>}
    </div>
  )
}
