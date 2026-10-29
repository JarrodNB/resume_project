/** Find shared US opportunities, then save a chosen listing to private Jobs.
 * Search owns submitted results and optional ordering; the form owns editable filters.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { PageHeading } from '@/components/PageHeading'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { JobBoardSearchForm } from './JobBoardSearchForm'
import { boardPageSize, describeSearch } from './searchFilters'
import { JobBoardPager } from './JobBoardPager'
import { JobBoardListingRow } from './JobBoardListingRow'
import { useImportJobBoardListing } from './useImportJobBoardListing'
import { useJobBoardSearch } from './useJobBoardSearch'
import { useJobBoardSearchIdeas } from './useJobBoardSearchIdeas'
import './jobBoard.css'


export function JobBoardPage() {
  const searchIdeas = useJobBoardSearchIdeas()
  const [keyword, setKeyword] = useState('')
  const [hideSaved, setHideSaved] = useState(false)
  const [rerankingEnabled, setRerankingEnabled] = useState(false)
  const board = useJobBoardSearch(rerankingEnabled)
  const { reranking, submittedSearch } = board
  const importer = useImportJobBoardListing()
  const navigate = useNavigate()

  async function createJob(listingId: string) {
    const result = await importer.save(listingId)
    if (result) navigate(`/jobs/${result.jobId}`, { state: { jobBoardImport: result } })
  }

  const visibleListings = board.listings.filter((listing) => !hideSaved || !listing.savedJob)
  const hiddenCount = board.listings.length - visibleListings.length
  // The wanted page belongs to one submitted search; a new search starts back at page 1.
  const [pageChoice, setPageChoice] = useState<{ search: unknown; page: number }>({ search: null, page: 0 })
  const totalPages = Math.max(1, Math.ceil(visibleListings.length / boardPageSize))
  const wantedPage = pageChoice.search === submittedSearch ? pageChoice.page : 0
  // Asking for the page after the last loaded one waits here until Load fetches it.
  const page = Math.min(wantedPage, totalPages - 1)
  const pageListings = visibleListings.slice(page * boardPageSize, (page + 1) * boardPageSize)

  function goToPage(next: number) {
    if (next > page && page >= totalPages - 1) board.loadMore()
    setPageChoice({ search: submittedSearch, page: next })
    document.getElementById('job-board-results')?.scrollIntoView?.({ block: 'start' })
  }

  return (
    <div className="job-board">
      <PageHeading title="Find jobs" description="Search current US listings. Save the roles you want to pursue to your saved jobs." />
      {!submittedSearch && <div className="board-introduction">
        <h2>Find a role worth your next step.</h2>
        <p>Start with a job title or a skill. Explore the details, then save the opportunities you want to pursue.</p>
        <div className="board-search-ideas" aria-label="Search ideas">
          {searchIdeas.map((idea) => <Button key={idea} type="button" variant="outline" onClick={() => { setKeyword(idea); document.getElementById('job-board-keyword')?.focus() }}>{idea}<ArrowRight size={14} aria-hidden /></Button>)}
        </div>
      </div>}
      <JobBoardSearchForm keyword={keyword} onKeywordChange={setKeyword} onSearch={board.search}>
        <div className="board-reranking-options">
          <Label className="board-remote" data-checked={rerankingEnabled}>
            <Checkbox aria-describedby="board-reranking-help" checked={rerankingEnabled} onCheckedChange={(checked) => setRerankingEnabled(checked === true)} />Rerank using my career library
          </Label>
          <p id="board-reranking-help">Combines your search terms with related career experience. Applies to loaded roles.</p>
        </div>
      </JobBoardSearchForm>

      {submittedSearch && <div id="job-board-results" className="board-results-heading">
        <div><p className="board-results-title">{board.loading && board.listings.length === 0 ? 'Finding opportunities' : 'Search results'}</p><p className="board-results-query">{describeSearch(submittedSearch)}</p></div>
        <div className="board-result-controls"><Label className="board-hide-saved"><Checkbox checked={hideSaved} onCheckedChange={(checked) => setHideSaved(checked === true)} />Hide already saved</Label>
          {board.listings.length > 0 && <span className="board-results-count">{visibleListings.length} shown · {board.listings.length} loaded{hiddenCount > 0 && ` · ${hiddenCount} saved hidden`}</span>}</div>
      </div>}
      {board.loading && <div role="status" className="board-loading"><span>Loading jobs…</span>
        {board.listings.length === 0 && <div aria-hidden="true" className="board-skeletons">{[0, 1, 2].map((item) => <div className="board-skeleton" key={item}><span /><span /><span /></div>)}</div>}
      </div>}
      {board.errors.length > 0 && <div className="grid gap-3">
        <ErrorAlert title="Couldn't load jobs" messages={board.errors} />
        <Button variant="outline" className="justify-self-start" onClick={() => board.retry()} disabled={board.loading}>Try again</Button>
      </div>}
      {reranking.busy && <p role="status" className="board-ranking-status"><span className="signal-dot is-ai" aria-hidden />Reranking loaded roles… Showing provider order while we work.</p>}
      {reranking.ranked && <p role="status" className="board-ranking-status">Loaded roles ranked using your career library.</p>}
      {reranking.limitReached && <p role="status" className="board-ranking-status">Reranking supports up to 100 loaded roles. Narrow your search to rerank these results. Showing provider order.</p>}
      {reranking.subscriptionError && <p role="status" className="board-ranking-status">{reranking.subscriptionError}</p>}
      {reranking.error && <div className="grid gap-3">
        <ErrorAlert title="Couldn't rerank jobs" messages={[reranking.error]} />
        <p className="board-ranking-status">Showing provider order.</p>
        <Button type="button" variant="outline" className="justify-self-start" onClick={reranking.retry}>Retry reranking</Button>
      </div>}
      <ErrorAlert title="Couldn't create this job" messages={importer.errors} />
      {!board.loading && board.pages.length > 0 && board.listings.length === 0 && <div className="board-no-results"><h2>No matching roles this time.</h2><p>No matches. Try another keyword or broaden your filters.</p></div>}
      {hideSaved && hiddenCount > 0 && visibleListings.length === 0 && <p className="board-saved-empty" role="status">All loaded roles are already saved.{board.nextCursor ? ' Go to the next page to keep looking, or turn off “Hide already saved”.' : ' Turn off “Hide already saved” to see them.'}</p>}
      {visibleListings.length > 0 && <ul aria-label="Job listings" className="board-listings">
        {pageListings.map((listing) => <JobBoardListingRow key={listing.id} listing={listing} busyId={importer.busyId} onCreate={(id) => void createJob(id)} />)}
      </ul>}
      {board.pages.length > 0 && <div className="board-results-footer">
        {(totalPages > 1 || board.nextCursor) && <JobBoardPager page={page} totalPages={totalPages} hasMore={Boolean(board.nextCursor)} loading={board.loading} onPage={goToPage} />}
        <div className="board-retrieval">{board.pages.map((page, index) => <div key={page.cursor ?? 'first'} className="grid gap-2">
          <p>{index > 0 && `Page ${index + 1} · `}{page.stale && 'Showing older results · '}Retrieved <time dateTime={page.retrievedAt}>{new Date(page.retrievedAt).toLocaleString()}</time></p>
          {page.stale && <><ErrorAlert title="Couldn't refresh these results" messages={page.errors} /><Button variant="outline" className="justify-self-start" disabled={board.loading} onClick={() => board.retry(page.cursor)}>Retry results</Button></>}
        </div>)}</div>
      </div>}
    </div>
  )
}
