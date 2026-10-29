/** Find shared US opportunities, then save a chosen listing to private Jobs.
 * The search form's keyword and main filters stay on top; its experience-level and later filters
 * become a sticky sidebar beside the results on wide screens so a search is visibly happening.
 * The URL owns submitted filters; a session visit retains results and ordering
 * while users open saved jobs or move through search history.
 * The form owns editable filters until submission.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { PageHeading } from '@/components/PageHeading'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { JobBoardAppliedFilters } from './JobBoardAppliedFilters'
import { JobBoardSearchForm } from './JobBoardSearchForm'
import { boardPageSize, describeSearch, type BoardSearch } from './searchFilters'
import { parseSearchUrl, serializeSearchUrl } from './searchUrl'
import { JobBoardPager } from './JobBoardPager'
import { JobBoardListingRow } from './JobBoardListingRow'
import { useImportJobBoardListing } from './useImportJobBoardListing'
import { useJobBoardSearch } from './useJobBoardSearch'
import { useJobBoardSearchIdeas } from './useJobBoardSearchIdeas'
import { useJobBoardVisit } from './useJobBoardVisit'
import type { JobBoardVisit } from './useJobBoardVisit'
import './jobBoard.css'


export function JobBoardPage() {
  const { visit, state, forgetSearch } = useJobBoardVisit()
  // Changing account or submitted URL remounts draft-only form state as well.
  return <JobBoardVisitPage key={visit.id} visit={visit} state={state} forgetSearch={forgetSearch} />
}

function JobBoardVisitPage({ visit, state, forgetSearch }: { visit: JobBoardVisit; state: ReturnType<JobBoardVisit['getState']>; forgetSearch: (search: string) => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  const urlSearch = parseSearchUrl(location.search)
  const appliedLocation = useRef<string | null>(null)
  const searchIdeas = useJobBoardSearchIdeas()
  const [keywordDraft, setKeywordDraft] = useState({ entry: location.key, value: urlSearch?.keyword ?? '' })
  if (keywordDraft.entry !== location.key) setKeywordDraft({ entry: location.key, value: urlSearch?.keyword ?? '' })
  const keyword = keywordDraft.entry === location.key ? keywordDraft.value : urlSearch?.keyword ?? ''
  function setKeyword(value: string) { setKeywordDraft({ entry: location.key, value }) }
  const { hideSaved, rerankingEnabled, savedHere, pageChoice } = state
  const setHideSaved = (hideSaved: boolean) => visit.update({ hideSaved })
  const setRerankingEnabled = (rerankingEnabled: boolean) => visit.update({ rerankingEnabled })
  const board = useJobBoardSearch(visit)
  const { reranking, submittedSearch } = board
  useEffect(() => {
    if (appliedLocation.current === location.key) return
    appliedLocation.current = location.key
    const submitted = parseSearchUrl(location.search)
    const canonical = submitted ? serializeSearchUrl(submitted) : ''
    if (canonical !== location.search) {
      void navigate({ pathname: location.pathname, search: canonical }, { replace: true })
      return
    }
    if (!visit.initialized) {
      if (submitted) board.search(submitted)
      else board.clear()
    }
  }, [location.key, location.pathname, location.search, navigate, board, visit.initialized])

  function submitSearch(search: BoardSearch) {
    const next = serializeSearchUrl(search)
    if (next === location.search) board.search(search)
    else {
      forgetSearch(next)
      void navigate({ pathname: location.pathname, search: next })
    }
  }
  const importer = useImportJobBoardListing(visit)
  // Listings saved from this page stay in place; the row offers a link to the new job instead.
  const returning = useRef(visit.initialized)
  useLayoutEffect(() => {
    if (returning.current) window.scrollTo({ top: visit.scrollY, behavior: 'instant' })
    const rememberScroll = () => { visit.scrollY = window.scrollY }
    window.addEventListener('scroll', rememberScroll)
    return () => { window.removeEventListener('scroll', rememberScroll) }
    // This effect belongs to the visit, rather than each async state update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit])

  // Stacked layout (narrow screens): bring the results into view so a search visibly happens.
  useEffect(() => {
    if (returning.current) { returning.current = false; return }
    if (!submittedSearch || window.matchMedia?.('(min-width: 1000px)').matches) return
    document.getElementById('job-board-results')?.scrollIntoView?.({ block: 'start' })
  }, [submittedSearch])

  async function createJob(listingId: string) {
    const result = await importer.save(listingId)
    if (result) visit.update((current) => ({ savedHere: { ...current.savedHere, [listingId]: result } }))
  }

  const visibleListings = board.listings.filter((listing) => !hideSaved || !listing.savedJob)
  const hiddenCount = board.listings.length - visibleListings.length
  // The wanted page belongs to one submitted search; a new search starts back at page 1.
  const totalPages = Math.max(1, Math.ceil(visibleListings.length / boardPageSize))
  const wantedPage = pageChoice.search === submittedSearch ? pageChoice.page : 0
  // Asking for the page after the last loaded one waits here until Load fetches it.
  const page = Math.min(wantedPage, totalPages - 1)
  const pageListings = visibleListings.slice(page * boardPageSize, (page + 1) * boardPageSize)

  function goToPage(next: number) {
    if (next > page && page >= totalPages - 1) board.loadMore()
    visit.update({ pageChoice: { search: submittedSearch, page: next } })
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
      <div className="board-layout">
      <JobBoardSearchForm key={location.key} initialSearch={urlSearch} keyword={keyword} onKeywordChange={setKeyword} onSearch={submitSearch}>
        <div className="board-reranking-options">
          <Label className="board-remote" data-checked={rerankingEnabled}>
            <Checkbox aria-describedby="board-reranking-help" checked={rerankingEnabled} onCheckedChange={(checked) => setRerankingEnabled(checked === true)} />Rerank using my career library
          </Label>
          <p id="board-reranking-help">Combines your search terms with related career experience. Applies to loaded roles.</p>
        </div>
      </JobBoardSearchForm>

      <div className="board-main">
      {submittedSearch && <div id="job-board-results" className="board-results-heading">
        <div><p className="board-results-title">{board.loading && board.listings.length === 0 ? 'Finding opportunities' : 'Search results'}</p><p className="board-results-query">{describeSearch(submittedSearch)}</p></div>
        <div className="board-result-controls"><Label className="board-hide-saved"><Checkbox checked={hideSaved} onCheckedChange={(checked) => setHideSaved(checked === true)} />Hide already saved</Label>
          {board.listings.length > 0 && <span className="board-results-count">{visibleListings.length} shown · {board.listings.length} loaded{hiddenCount > 0 && ` · ${hiddenCount} saved hidden`}</span>}</div>
      </div>}
      {submittedSearch && <JobBoardAppliedFilters search={submittedSearch} onSearch={submitSearch} />}
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
        {pageListings.map((listing) => <JobBoardListingRow key={listing.id} listing={listing} busyId={importer.busyId} savedHere={savedHere[listing.id]} onCreate={(id) => void createJob(id)} />)}
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
