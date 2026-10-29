/** Owns the submitted search, provider pages and optional ordering as one snapshot.
 * Drafts stay in the form. Each accepted page creates a fresh ranking identity;
 * retries keep successful pages, and superseded requests cannot replace this search.
 * Rails owns freshness and listing identity.
 */
import { useRef, useState } from 'react'
import { useApolloClient } from '@apollo/client/react'
import type { JobBoardSearchQuery } from '@/graphql/generated/graphql'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { JOB_BOARD_SEARCH_QUERY } from './jobBoardOperations'
import type { BoardSearch } from './searchFilters'
import { useJobBoardReranking } from './useJobBoardReranking'

type SearchPage = JobBoardSearchQuery['jobBoardSearch']
export type BoardListing = SearchPage['listings'][number]
type LoadedPage = Omit<SearchPage, 'retrievedAt'> & { retrievedAt: string; cursor: string | null }
export type SearchSnapshot = { submitted: BoardSearch | null; pages: LoadedPage[]; listings: BoardListing[] }

function providerListings(pages: LoadedPage[]): BoardListing[] {
  const seen = new Set<string>()
  return pages.flatMap((page) => page.listings).filter((listing) => {
    if (seen.has(listing.id)) return false
    seen.add(listing.id)
    return true
  })
}

/** Submit a form snapshot; displayed context, pagination and optional ranking stay together. */
export function useJobBoardSearch() {
  const client = useApolloClient()
  const generation = useRef(0)
  const pending = useRef(false)
  const [snapshot, setSnapshot] = useState<SearchSnapshot>({ submitted: null, pages: [], listings: [] })
  const { submitted, pages } = snapshot
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [failedCursor, setFailedCursor] = useState<string | null>(null)
  const { listings, ...reranking } = useJobBoardReranking(snapshot)

  async function request(search: BoardSearch, cursor: string | null, current: number) {
    pending.current = true
    setLoading(true)
    setErrors([])
    try {
      // Rails owns shared freshness, including shorter date-filtered cache windows.
      const { keyword, remoteOnly, experienceLevels, filters } = search
      const { data } = await client.query({ query: JOB_BOARD_SEARCH_QUERY, variables: { keyword, remoteOnly, experienceLevels, ...(filters && { filters }), cursor }, fetchPolicy: 'no-cache' })
      if (generation.current !== current) return
      const page = data?.jobBoardSearch
      if (!page?.retrievedAt) {
        setErrors(page?.errors.length ? page.errors : ['Could not load jobs. Please try again.'])
        setFailedCursor(cursor)
        return
      }
      const replacement: LoadedPage = { ...page, retrievedAt: page.retrievedAt, cursor }
      setSnapshot((snapshot) => {
        const existing = snapshot.pages
        const index = existing.findIndex((item) => item.cursor === cursor)
        // A new continuation starts a different chain; old descendants no longer belong.
        const retained = index < 0 || existing[index].nextCursor === page.nextCursor ? existing : existing.slice(0, index + 1)
        const pages = index < 0 ? [...existing, replacement] : retained.map((item) => item.cursor === cursor ? replacement : item)
        return { ...snapshot, pages, listings: providerListings(pages) }
      })
    } catch (error) {
      if (generation.current !== current) return
      setErrors([requestErrorMessage(error, 'Could not load jobs. Please try again.')])
      setFailedCursor(cursor)
    } finally {
      if (generation.current === current) {
        pending.current = false
        setLoading(false)
      }
    }
  }

  function search(draft: BoardSearch) {
    if (!draft.keyword.trim()) return
    const submitted = { ...draft, keyword: draft.keyword.trim(), experienceLevels: [...draft.experienceLevels], ...(draft.filters && { filters: { ...draft.filters, ...(draft.filters.employmentTypes && { employmentTypes: [...draft.filters.employmentTypes] }) } }) }
    generation.current += 1
    setSnapshot({ submitted, pages: [], listings: [] })
    setErrors([])
    void request(submitted, null, generation.current)
  }

  function retry(cursor: string | null = failedCursor) {
    if (pending.current || !submitted) return
    void request(submitted, cursor, generation.current)
  }

  const nextCursor = pages.at(-1)?.nextCursor ?? null
  function loadMore() {
    if (!nextCursor || pending.current || !submitted || pages.some((page) => page.cursor === nextCursor)) return
    void request(submitted, nextCursor, generation.current)
  }

  return { listings, providerListings: snapshot.listings, snapshot, submittedSearch: submitted, reranking, pages, loading, errors, search, retry, loadMore, nextCursor: pages.some((page) => page.cursor === nextCursor) ? null : nextCursor }
}
