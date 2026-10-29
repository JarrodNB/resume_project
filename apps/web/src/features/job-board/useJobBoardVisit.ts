/** Keep a few recent searches while this signed-in app session stays open.
 * Nothing is written to browser storage. Replacing the session's Apollo client
 * starts an empty history; refreshing the app does too. Async completions update
 * the visit even while its page is closed, so returning cannot strand a request.
 */
import { useSyncExternalStore } from 'react'
import { useApolloClient } from '@apollo/client/react'
import { useLocation } from 'react-router'
import type { SearchSnapshot } from './useJobBoardSearch'
import type { RerankingRequest } from './useJobBoardReranking'

interface VisitState {
  snapshot: SearchSnapshot
  loading: boolean
  errors: string[]
  failedCursor: string | null
  hideSaved: boolean
  rerankingEnabled: boolean
  savedHere: Record<string, { jobId: string; warnings: string[] }>
  busyId: string | null
  importErrors: string[]
  pageChoice: { search: unknown; page: number }
  rankingRevision: number
}
let nextId = 0
function createVisit(preferences: Pick<VisitState, 'hideSaved' | 'rerankingEnabled'> | undefined, discard: () => void) {
  let state: VisitState = {
    snapshot: { submitted: null, pages: [], listings: [] }, loading: false, errors: [], failedCursor: null,
    hideSaved: false, rerankingEnabled: false, savedHere: {}, busyId: null, importErrors: [],
    pageChoice: { search: null, page: 0 }, rankingRevision: 0, ...preferences,
  }
  let generation = 0
  let pending = false
  let initialized = false
  const listeners = new Set<() => void>()
  function discardOversizedVisit() {
    if (listeners.size === 0 && state.snapshot.pages.reduce((count, page) => count + page.listings.length, 0) > 200) discard()
  }
  return {
    id: ++nextId, scrollY: 0,
    get generation() { return generation },
    get pending() { return pending },
    get initialized() { return initialized },
    startSearch() { initialized = true; generation += 1 },
    setPending(value: boolean) { pending = value },
    requests: new Map<object, RerankingRequest>(),
    getState: () => state,
    update(change: Partial<VisitState> | ((current: VisitState) => Partial<VisitState>)) {
      state = { ...state, ...(typeof change === 'function' ? change(state) : change) }
      listeners.forEach((listener) => listener())
      discardOversizedVisit()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener); discardOversizedVisit() }
    },
  }
}
export type JobBoardVisit = ReturnType<typeof createVisit>
const sessions = new WeakMap<object, { visits: Map<string, JobBoardVisit>; latest?: JobBoardVisit }>()

export function useJobBoardVisit() {
  const client = useApolloClient()
  const { search } = useLocation()
  let session = sessions.get(client)
  if (!session) { session = { visits: new Map() }; sessions.set(client, session) }
  const { visits } = session
  let visit = visits.get(search)
  if (!visit) {
    const preferences = session.latest?.getState()
    const created = createVisit(preferences && { hideSaved: preferences.hideSaved, rerankingEnabled: preferences.rerankingEnabled }, () => {
      if (visits.get(search) === created) visits.delete(search)
      if (session.latest === created) session.latest = undefined
    })
    visit = created
    visits.set(search, visit)
    // Retain at most five searches. Large searches remain usable while open but
    // are fetched fresh after leaving, rather than retaining an unlimited corpus.
    while (visits.size > 5) visits.delete(visits.keys().next().value!)
  }
  session.latest = visit
  const state = useSyncExternalStore(visit.subscribe, visit.getState)
  return { visit, state, forgetSearch: (urlSearch: string) => { visits.delete(urlSearch) } }
}
