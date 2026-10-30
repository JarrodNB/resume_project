/** Select a retained visit for this URL within the signed-in Apollo session.
 * Keeps at most five searches in memory; inactive oversized visits discard themselves.
 * Replacing the client starts a private empty session. React observes the visit's state.
 */
import { useSyncExternalStore } from 'react'
import { useApolloClient } from '@apollo/client/react'
import { useLocation } from 'react-router'
import { createJobBoardVisit, type JobBoardVisit } from './jobBoardVisit'

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
    const created = createJobBoardVisit(client, preferences && { hideSaved: preferences.hideSaved }, () => {
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
