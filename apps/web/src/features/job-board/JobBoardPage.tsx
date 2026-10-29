/** Find shared US opportunities, then save a chosen listing to private Jobs.
 * On wide screens the search form is a sticky sidebar so results stay in view beside it.
 * Search owns submitted results and optional ordering; the form owns editable filters.
 */
import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { PageHeading } from '@/components/PageHeading'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { JobBoardSearchForm } from './JobBoardSearchForm'
import { JobPreferences } from './JobPreferences'
import { boardPageSize, describeSearch } from './searchFilters'
import { JobBoardPager } from './JobBoardPager'
import { JobBoardListingRow } from './JobBoardListingRow'
import { useImportJobBoardListing } from './useImportJobBoardListing'
import { useJobBoardSearch } from './useJobBoardSearch'
import { useBoardPreferenceCheck } from './useBoardPreferenceCheck'
import './jobBoard.css'

const searchIdeas = ['Software engineer', 'Product designer', 'Data analyst']

export function JobBoardPage() {
  const [keyword, setKeyword] = useState('')
  const [hideSaved, setHideSaved] = useState(false)
  const [ordering, setOrdering] = useState<'provider' | 'library' | 'preferences'>('provider')
  const board = useJobBoardSearch()
  const preferenceCheck = useBoardPreferenceCheck(board.snapshot)
  const { reranking, submittedSearch } = board
  const importer = useImportJobBoardListing()
  // Listings saved from this page stay in place; the row offers a link to the new job instead.
  const [savedHere, setSavedHere] = useState<Record<string, { jobId: string; warnings: string[] }>>({})

  // Stacked layout (narrow screens): bring the results into view so a search visibly happens.
  useEffect(() => {
    if (!submittedSearch || window.matchMedia?.('(min-width: 1000px)').matches) return
    document.getElementById('job-board-results')?.scrollIntoView?.({ block: 'start' })
  }, [submittedSearch])

  async function createJob(listingId: string) {
    const result = await importer.save(listingId)
    if (result) setSavedHere((current) => ({ ...current, [listingId]: result }))
  }

  const orderedListings = ordering === 'preferences' ? preferenceCheck.orderedListings : ordering === 'library' ? board.listings : board.providerListings
  const visibleListings = orderedListings.filter((listing) => !hideSaved || !listing.savedJob)
  const hiddenCount = board.listings.length - visibleListings.length
  // The wanted page belongs to one submitted search; a new search starts back at page 1.
  const [pageChoice, setPageChoice] = useState<{ search: unknown; order: string; page: number }>({ search: null, order: 'provider', page: 0 })
  const totalPages = Math.max(1, Math.ceil(visibleListings.length / boardPageSize))
  const wantedPage = pageChoice.search === submittedSearch && pageChoice.order === ordering ? pageChoice.page : 0
  // Asking for the page after the last loaded one waits here until Load fetches it.
  const page = Math.min(wantedPage, totalPages - 1)
  const pageListings = visibleListings.slice(page * boardPageSize, (page + 1) * boardPageSize)

  function goToPage(next: number) {
    if (next > page && page >= totalPages - 1) board.loadMore()
    setPageChoice({ search: submittedSearch, order: ordering, page: next })
    document.getElementById('job-board-results')?.scrollIntoView?.({ block: 'start' })
  }

  return (
    <div className="job-board">
      <PageHeading title="Find jobs" description="Search current US listings. Save the roles you want to pursue to your saved jobs." />
      <JobPreferences />
      <div className="board-layout">
      <JobBoardSearchForm keyword={keyword} onKeywordChange={setKeyword} onSearch={board.search}>
        <div className="board-reranking-options">
          <Button type="button" variant="outline" disabled={board.loading || reranking.busy || !board.providerListings.length || board.providerListings.length > 100} onClick={() => { reranking.start(); setOrdering('library') }}>Rerank using my career library</Button>
          <p id="board-reranking-help">Explicitly rank loaded roles using related career experience. Changing result order reuses completed rankings.</p>
        </div>
      </JobBoardSearchForm>

      <div className="board-main">
      {!submittedSearch && <div className="board-introduction">
        <h2>Find a role worth your next step.</h2>
        <p>Start with a job title or a skill. Explore the details, then save the opportunities you want to pursue.</p>
        <div className="board-search-ideas" aria-label="Search ideas">
          {searchIdeas.map((idea) => <Button key={idea} type="button" variant="outline" onClick={() => { setKeyword(idea); document.getElementById('job-board-keyword')?.focus() }}>{idea}<ArrowRight size={14} aria-hidden /></Button>)}
        </div>
      </div>}
      {submittedSearch && <div id="job-board-results" className="board-results-heading">
        <div><p className="board-results-title">{board.loading && board.listings.length === 0 ? 'Finding opportunities' : 'Search results'}</p><p className="board-results-query">{describeSearch(submittedSearch)}</p></div>
        <div className="board-result-controls"><Label className="board-hide-saved"><Checkbox checked={hideSaved} onCheckedChange={(checked) => setHideSaved(checked === true)} />Hide already saved</Label>
          {board.listings.length > 0 && <span className="board-results-count">{visibleListings.length} shown · {board.listings.length} loaded{hiddenCount > 0 && ` · ${hiddenCount} saved hidden`}</span>}</div>
      </div>}
      {board.providerListings.length > 0 && <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={board.loading || preferenceCheck.busy || preferenceCheck.completed || preferenceCheck.limitReached} onClick={() => { void preferenceCheck.check(); setOrdering('preferences') }}>Check these results</Button>
          <Label htmlFor="job-board-result-order">Result order</Label>
          <select id="job-board-result-order" className="rounded border bg-background px-3 py-2 text-sm" value={ordering} onChange={(event) => setOrdering(event.target.value as typeof ordering)}>
            <option value="provider">Search order</option>
            <option value="library" disabled={!reranking.ranked}>Career-library relevance</option>
            <option value="preferences" disabled={!preferenceCheck.completed}>Preference fit</option>
          </select>
        </div>
        {preferenceCheck.busy && <p role="status">Checking loaded roles against your preferences…</p>}
        {preferenceCheck.completed && <p role="status">Loaded roles checked against your confirmed preferences.</p>}
        {preferenceCheck.stale && <p role="status">These results or confirmed preferences changed. Check these results again for a current assessment.</p>}
        {preferenceCheck.limitReached && <p role="status">Preference checks support up to 100 loaded roles. Narrow your search before checking.</p>}
        {preferenceCheck.disconnected && <p role="status">Preference check updates disconnected. Reconnect or check again to recover the result.</p>}
        <ErrorAlert title="Couldn't check preferences" messages={preferenceCheck.error ? [preferenceCheck.error] : []} />
      </div>}
      {board.loading && <div role="status" className="board-loading"><span>Loading jobs…</span>
        {board.listings.length === 0 && <div aria-hidden="true" className="board-skeletons">{[0, 1, 2].map((item) => <div className="board-skeleton" key={item}><span /><span /><span /></div>)}</div>}
      </div>}
      {board.errors.length > 0 && <div className="grid gap-3">
        <ErrorAlert title="Couldn't load jobs" messages={board.errors} />
        <Button variant="outline" className="justify-self-start" onClick={() => board.retry()} disabled={board.loading}>Try again</Button>
      </div>}
      {reranking.busy && <p role="status" className="board-ranking-status"><span className="signal-dot is-ai" aria-hidden />Reranking loaded roles…</p>}
      {reranking.ranked && ordering === 'library' && <p role="status" className="board-ranking-status">Loaded roles ranked using your career library.</p>}
      {reranking.limitReached && <p role="status" className="board-ranking-status">Reranking supports up to 100 loaded roles. Narrow your search to rerank these results. Showing provider order.</p>}
      {reranking.subscriptionError && <p role="status" className="board-ranking-status">{reranking.subscriptionError}</p>}
      {reranking.error && <div className="grid gap-3">
        <ErrorAlert title="Couldn't rerank jobs" messages={[reranking.error]} />
        {ordering === 'library' && <p className="board-ranking-status">Showing search order.</p>}
        <Button type="button" variant="outline" className="justify-self-start" onClick={reranking.retry}>Retry reranking</Button>
      </div>}
      <ErrorAlert title="Couldn't create this job" messages={importer.errors} />
      {!board.loading && board.pages.length > 0 && board.listings.length === 0 && <div className="board-no-results"><h2>No matching roles this time.</h2><p>No matches. Try another keyword or broaden your filters.</p></div>}
      {hideSaved && hiddenCount > 0 && visibleListings.length === 0 && <p className="board-saved-empty" role="status">All loaded roles are already saved.{board.nextCursor ? ' Go to the next page to keep looking, or turn off “Hide already saved”.' : ' Turn off “Hide already saved” to see them.'}</p>}
      {visibleListings.length > 0 && <ul aria-label="Job listings" className="board-listings">
        {pageListings.map((listing) => <JobBoardListingRow key={listing.id} listing={listing} assessment={preferenceCheck.assessments?.has(listing.id) && preferenceCheck.profile ? { ...preferenceCheck.assessments.get(listing.id)!, profile: preferenceCheck.profile } : undefined} busyId={importer.busyId} savedHere={savedHere[listing.id]} onCreate={(id) => void createJob(id)} />)}
      </ul>}
      {board.pages.length > 0 && <div className="board-results-footer">
        {(totalPages > 1 || board.nextCursor) && <JobBoardPager page={page} totalPages={totalPages} hasMore={Boolean(board.nextCursor)} loading={board.loading} onPage={goToPage} />}
        <div className="board-retrieval">{board.pages.map((page, index) => <div key={page.cursor ?? 'first'} className="grid gap-2">
          <p>{index > 0 && `Page ${index + 1} · `}{page.stale && 'Showing older results · '}Retrieved <time dateTime={page.retrievedAt}>{new Date(page.retrievedAt).toLocaleString()}</time></p>
          {page.stale && <><ErrorAlert title="Couldn't refresh these results" messages={page.errors} /><Button variant="outline" className="justify-self-start" disabled={board.loading} onClick={() => board.retry(page.cursor)}>Retry results</Button></>}
        </div>)}</div>
      </div>}
      </div>
      </div>
    </div>
  )
}
