/** One explicit task covers the raw loaded search snapshot and one confirmed profile revision.
 * Local display choices cannot start work; stale callbacks remain attached to their old scope.
 * The session visit retains pending and completed work across navigation without buying it again.
 */
import { useLayoutEffect, useRef } from 'react'
import { useApolloClient, useQuery, useSubscription } from '@apollo/client/react'
import type { AiTaskStatusEnum, JobPreferencesQuery } from '@/graphql/generated/graphql'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { JOB_PREFERENCES_QUERY } from './jobPreferenceOperations'
import { CHECK_JOB_BOARD_PREFERENCE_RESULTS, JOB_PREFERENCE_CHECK_SUBSCRIPTION } from './preferenceCheckOperations'
import { boardPreferenceDecisions, orderByPreferences } from './preferenceAssessments'
import type { JobBoardVisit } from './useJobBoardVisit'
import type { SearchSnapshot } from './useJobBoardSearch'

type Profile = JobPreferencesQuery['jobPreferences']
type Identity = { client: object; scope: SearchSnapshot; revision?: number }
type CheckTask = { id: string; status: AiTaskStatusEnum; result: unknown; errorMessage?: string | null }
type Request = Identity & { profile: Profile; task: CheckTask }
export interface PreferenceCheckState {
  active: boolean
  request: Request | null
  pending: Identity | null
  failure: (Identity & { message: string }) | null
}
export type PreferenceCheckLock = Identity | null
const sameScope = (left: Identity | null, right: Identity) => left?.client === right.client && left.scope === right.scope

export function useBoardPreferenceCheck(snapshot: SearchSnapshot, visit: JobBoardVisit) {
  const client = useApolloClient()
  const { active, request, pending, failure } = visit.getState().preferenceCheck
  const setActive = (active: boolean) => visit.update((state) => ({ preferenceCheck: { ...state.preferenceCheck, active } }))
  const setRequest = (change: Request | null | ((current: Request | null) => Request | null)) => visit.update((state) => ({ preferenceCheck: { ...state.preferenceCheck, request: typeof change === 'function' ? change(state.preferenceCheck.request) : change } }))
  const setPending = (change: Identity | null | ((current: Identity | null) => Identity | null)) => visit.update((state) => ({ preferenceCheck: { ...state.preferenceCheck, pending: typeof change === 'function' ? change(state.preferenceCheck.pending) : change } }))
  const setFailure = (failure: PreferenceCheckState['failure']) => visit.update((state) => ({ preferenceCheck: { ...state.preferenceCheck, failure } }))
  const { data } = useQuery(JOB_PREFERENCES_QUERY, { skip: !active, fetchPolicy: 'cache-first' })
  const identity = { client, scope: snapshot, revision: data?.jobPreferences.confirmedRevision }
  const latest = useRef(identity)
  useLayoutEffect(() => { latest.current = identity })
  const same = (value: Identity | null) => sameScope(value, identity) && (value?.revision === undefined || value.revision === identity.revision)
  const current = request && same(request) ? request : null
  const { error: subscriptionError } = useSubscription(JOB_PREFERENCE_CHECK_SUBSCRIPTION, {
    variables: { id: current?.task.id ?? '' }, skip: !current || current.task.status !== 'QUEUED',
    onData: ({ data }) => {
      const update = data.data?.aiTaskUpdated
      if (!update || update.status === 'QUEUED') return
      setRequest((value) => !value || value.task.id !== update.id || !sameScope(value, latest.current)
        || value.profile.confirmedRevision !== latest.current.revision ? value : { ...value, task: update })
    },
  })
  const task = current?.task
  const assessments = current && task?.status === 'COMPLETED' ? boardPreferenceDecisions(task.result, snapshot.listings, current.profile) : null

  async function check() {
    const operation: Identity = { client, scope: snapshot }
    if ((sameScope(visit.preferenceLock, operation) && (visit.preferenceLock?.revision === undefined || visit.preferenceLock.revision === identity.revision)) || !snapshot.listings.length || snapshot.listings.length > 100) return
    visit.setPreferenceLock(operation)
    setPending(operation)
    setFailure(null)
    const isCurrent = () => sameScope(latest.current, operation) && (operation.revision === undefined || latest.current.revision === undefined || latest.current.revision === operation.revision)
    const fail = (message: string) => { if (isCurrent()) setFailure({ ...operation, message }) }
    try {
      const profile = (await client.query({ query: JOB_PREFERENCES_QUERY, fetchPolicy: 'network-only' })).data?.jobPreferences
      if (!isCurrent()) return
      if (!profile?.confirmedCriteria.length) { fail('Confirm your preferences in “What I want next” before checking.'); return }
      operation.revision = profile.confirmedRevision
      setPending({ ...operation })
      setActive(true)
      const response = (await client.mutate({ mutation: CHECK_JOB_BOARD_PREFERENCE_RESULTS, variables: {
        confirmedRevision: profile.confirmedRevision,
        listings: snapshot.listings.map((listing) => ({ listingId: listing.id, expectedDigest: listing.preferenceSourceDigest })),
      } })).data?.checkJobBoardPreferenceResults
      if (!isCurrent()) return
      if (!response?.aiTask || response.errors.length) { fail(response?.errors.join(' ') || 'Could not start this check. Please try again.'); return }
      setRequest({ ...operation, profile, task: response.aiTask })
    } catch (cause) { fail(requestErrorMessage(cause, 'Could not check these results. Please try again.')) }
    finally {
      if (visit.preferenceLock === operation) visit.setPreferenceLock(null)
      setPending((value) => value && sameScope(value, operation) && value.revision === operation.revision ? null : value)
    }
  }

  return { check, assessments, profile: current?.profile,
    orderedListings: assessments && current ? orderByPreferences(snapshot.listings, assessments, current.profile) : snapshot.listings,
    completed: Boolean(assessments), stale: Boolean(request && !current),
    busy: same(pending) || Boolean(task?.status === 'QUEUED' && !subscriptionError),
    error: (failure && same(failure) ? failure.message : null)
      || (task?.status === 'FAILED' ? task.errorMessage || 'The preference check failed. Please try again.' : null)
      || (task?.status === 'COMPLETED' && !assessments ? 'The check returned incomplete evidence. Please try again.' : null),
    disconnected: Boolean(current && subscriptionError), limitReached: snapshot.listings.length > 100 }
}
