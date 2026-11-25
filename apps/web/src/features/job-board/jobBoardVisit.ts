/** Keeps one submitted job search usable across navigation and late async completions.
 * The visit owns request ordering, loaded pages, saving and display choices.
 * Callers read its state and invoke actions; request locks stay private.
 * Numbered navigation can request one unloaded batch; short batches keep the last valid
 * display page without following more cursors automatically. Rails still owns provider
 * freshness and private Job persistence.
 */
import type { ApolloClient } from '@apollo/client'
import type { JobBoardSearchQuery } from '@/graphql/generated/graphql'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { IMPORT_JOB_BOARD_LISTING_MUTATION, JOB_BOARD_SEARCH_QUERY } from './jobBoardOperations'
import { boardPageSize, type BoardSearch } from './searchFilters'

type SearchPage = JobBoardSearchQuery['jobBoardSearch']
export type BoardListing = SearchPage['listings'][number]
type LoadedPage = Omit<SearchPage, 'retrievedAt'> & { retrievedAt: string; cursor: string | null }
export type SearchSnapshot = { submitted: BoardSearch | null; pages: LoadedPage[]; listings: BoardListing[] }
interface VisitState {
  snapshot: SearchSnapshot
  loading: boolean
  errors: string[]
  failedCursor: string | null
  hideSaved: boolean
  savedHere: Record<string, { jobId: string; warnings: string[] }>
  busyId: string | null
  importErrors: string[]
  pageChoice: { search: BoardSearch | null; page: number }
}
export type VisitPreferences = Pick<VisitState, 'hideSaved'>
let nextId = 0

function providerListings(pages: LoadedPage[]): BoardListing[] {
  const seen = new Set<string>()
  return pages.flatMap((page) => page.listings).filter((listing) => {
    if (seen.has(listing.id)) return false
    seen.add(listing.id)
    return true
  })
}

/** Create a visit for one session's Apollo client; no data is persisted in browser storage. */
export function createJobBoardVisit(client: ApolloClient, preferences: VisitPreferences | undefined, discard: () => void) {
  let state: VisitState = {
    snapshot: { submitted: null, pages: [], listings: [] }, loading: false, errors: [], failedCursor: null,
    hideSaved: false, savedHere: {}, busyId: null, importErrors: [],
    pageChoice: { search: null, page: 0 }, ...preferences,
  }
  let generation = 0
  let pending = false
  let initialized = false
  let scrollY = 0
  const listeners = new Set<() => void>()

  function discardOversizedVisit() {
    if (listeners.size === 0 && state.snapshot.pages.reduce((count, page) => count + page.listings.length, 0) > 200) discard()
  }
  function update(change: Partial<VisitState>) {
    state = { ...state, ...change }
    listeners.forEach((listener) => listener())
    discardOversizedVisit()
  }
  function nextCursor() {
    const cursor = state.snapshot.pages.at(-1)?.nextCursor ?? null
    return state.snapshot.pages.some((page) => page.cursor === cursor) ? null : cursor
  }
  async function request(search: BoardSearch, cursor: string | null, current: number) {
    pending = true
    update({ loading: true, errors: [] })
    try {
      const { keyword, remoteOnly, experienceLevels, filters } = search
      const { data } = await client.query({ query: JOB_BOARD_SEARCH_QUERY, variables: { keyword, remoteOnly, experienceLevels, ...(filters && { filters }), cursor }, fetchPolicy: 'no-cache' })
      if (generation !== current) return
      const page = data?.jobBoardSearch
      if (!page?.retrievedAt) {
        update({ errors: page?.errors.length ? page.errors : ['Could not load jobs. Please try again.'], failedCursor: cursor })
        return
      }
      const replacement: LoadedPage = { ...page, retrievedAt: page.retrievedAt, cursor }
      const existing = state.snapshot.pages
      const index = existing.findIndex((item) => item.cursor === cursor)
      // Changed continuation invalidates descendants, but an unchanged one retains them.
      const retained = index < 0 || existing[index].nextCursor === page.nextCursor ? existing : existing.slice(0, index + 1)
      const pages = index < 0 ? [...existing, replacement] : retained.map((item) => item.cursor === cursor ? replacement : item)
      update({ snapshot: { ...state.snapshot, pages, listings: providerListings(pages) } })
    } catch (error) {
      if (generation !== current) return
      update({ errors: [requestErrorMessage(error, 'Could not load jobs. Please try again.')], failedCursor: cursor })
    } finally {
      if (generation === current) {
        pending = false
        update({ loading: false })
      }
    }
  }
  function search(draft: BoardSearch) {
    if (!draft.keyword.trim()) return
    const submitted = { ...draft, keyword: draft.keyword.trim(), experienceLevels: [...draft.experienceLevels], ...(draft.filters && { filters: { ...draft.filters, ...(draft.filters.employmentTypes && { employmentTypes: [...draft.filters.employmentTypes] }) } }) }
    initialized = true
    generation += 1
    update({ failedCursor: null, snapshot: { submitted, pages: [], listings: [] }, errors: [] })
    void request(submitted, null, generation)
  }
  function clear() {
    initialized = true
    generation += 1
    pending = false
    update({ snapshot: { submitted: null, pages: [], listings: [] }, loading: false, errors: [], failedCursor: null })
  }
  function retry(cursor: string | null = state.failedCursor) {
    if (pending || !state.snapshot.submitted) return
    void request(state.snapshot.submitted, cursor, generation)
  }
  function loadMore() {
    const cursor = nextCursor()
    if (!cursor || pending || !state.snapshot.submitted) return
    void request(state.snapshot.submitted, cursor, generation)
  }
  async function save(listingId: string) {
    if (state.busyId) return
    update({ busyId: listingId, importErrors: [] })
    try {
      const { data } = await client.mutate({ mutation: IMPORT_JOB_BOARD_LISTING_MUTATION, variables: { listingId } })
      const payload = data?.importJobBoardListing
      if (!payload?.job || payload.errors.length) {
        update({ importErrors: payload?.errors.length ? payload.errors : ['Could not save this job. Please try again.'] })
        return
      }
      client.cache.evict({ id: 'ROOT_QUERY', fieldName: 'jobs' })
      update({ savedHere: { ...state.savedHere, [listingId]: { jobId: payload.job.id, warnings: payload.warnings } } })
    } catch (error) {
      update({ importErrors: [requestErrorMessage(error, 'Could not save this job. Please try again.')] })
    } finally {
      update({ busyId: null })
    }
  }
  function getResults(listings: BoardListing[]) {
    const visibleListings = listings.filter((listing) => !state.hideSaved || !listing.savedJob)
    const totalPages = Math.max(1, Math.ceil(visibleListings.length / boardPageSize))
    const wantedPage = state.pageChoice.search === state.snapshot.submitted ? state.pageChoice.page : 0
    const page = Math.min(wantedPage, totalPages - 1)
    return { page, totalPages, visibleCount: visibleListings.length, hiddenCount: listings.length - visibleListings.length,
      pageListings: visibleListings.slice(page * boardPageSize, (page + 1) * boardPageSize) }
  }
  function goToPage(page: number, listings: BoardListing[]) {
    const current = getResults(listings)
    if (page >= current.totalPages) loadMore()
    update({ pageChoice: { search: state.snapshot.submitted, page } })
  }
  return {
    id: ++nextId,
    get initialized() { return initialized },
    get scrollY() { return scrollY },
    rememberScroll(value: number) { scrollY = value },
    getState: (): Readonly<VisitState> => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener); discardOversizedVisit() }
    },
    search, clear, retry, loadMore, save, nextCursor, getResults, goToPage,
    setHideSaved(hideSaved: boolean) { update({ hideSaved }) },
  }
}
export type JobBoardVisit = ReturnType<typeof createJobBoardVisit>
