/** Owns one submitted search and its ordered pages. Rails owns freshness and listing identity.
 * Submitted filters are snapshots reused by pagination and retry. Request generations keep slow, superseded searches from changing the current screen.
 */
import { useRef, useState } from 'react'
import { useApolloClient } from '@apollo/client/react'
import type { JobBoardExperienceLevel, JobBoardSearchQuery } from '@/graphql/generated/graphql'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { JOB_BOARD_SEARCH_QUERY } from './jobBoardOperations'

type SearchPage = JobBoardSearchQuery['jobBoardSearch']
export type BoardListing = SearchPage['listings'][number]
type LoadedPage = Omit<SearchPage, 'retrievedAt'> & { retrievedAt: string; cursor: string | null }
type Search = { keyword: string; remoteOnly: boolean; experienceLevels: JobBoardExperienceLevel[] }

export function useJobBoardSearch() {
  const client = useApolloClient()
  const generation = useRef(0)
  const pending = useRef(false)
  const submitted = useRef<Search | null>(null)
  const [pages, setPages] = useState<LoadedPage[]>([])
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [failedCursor, setFailedCursor] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)

  async function request(search: Search, cursor: string | null, current: number) {
    pending.current = true
    setLoading(true)
    setErrors([])
    try {
      // Do not let Apollo's cache replace Rails' shared 24-hour search policy.
      const { data } = await client.query({ query: JOB_BOARD_SEARCH_QUERY, variables: { ...search, cursor }, fetchPolicy: 'no-cache' })
      if (generation.current !== current) return
      const page = data?.jobBoardSearch
      if (!page?.retrievedAt) {
        setErrors(page?.errors.length ? page.errors : ['Could not load jobs. Please try again.'])
        setFailedCursor(cursor)
        return
      }
      const replacement: LoadedPage = { ...page, retrievedAt: page.retrievedAt, cursor }
      setPages((existing) => {
        const index = existing.findIndex((item) => item.cursor === cursor)
        if (index < 0) return [...existing, replacement]
        // A new continuation starts a different chain; old descendants no longer belong.
        const retained = existing[index].nextCursor === page.nextCursor ? existing : existing.slice(0, index + 1)
        return retained.map((item) => item.cursor === cursor ? replacement : item)
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

  function search(keyword: string, remoteOnly: boolean, experienceLevels: JobBoardExperienceLevel[] = []) {
    if (!keyword.trim()) return
    submitted.current = { keyword: keyword.trim(), remoteOnly, experienceLevels: [...experienceLevels] }
    generation.current += 1
    setPages([])
    setErrors([])
    setHasSearched(true)
    void request(submitted.current, null, generation.current)
  }

  function retry(cursor: string | null = failedCursor) {
    if (pending.current || !submitted.current) return
    void request(submitted.current, cursor, generation.current)
  }

  const nextCursor = pages.at(-1)?.nextCursor ?? null
  function loadMore() {
    if (!nextCursor || pending.current || !submitted.current || pages.some((page) => page.cursor === nextCursor)) return
    void request(submitted.current, nextCursor, generation.current)
  }
  const seen = new Set<string>()
  const listings = pages.flatMap((page) => page.listings).filter((listing) => {
    if (seen.has(listing.id)) return false
    seen.add(listing.id)
    return true
  })

  return { listings, pages, loading, errors, hasSearched, search, retry, loadMore, nextCursor: pages.some((page) => page.cursor === nextCursor) ? null : nextCursor }
}
