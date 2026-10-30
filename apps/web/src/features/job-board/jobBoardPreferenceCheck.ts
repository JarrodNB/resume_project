/** Retain one explicit preference check with its search visit, even while the page is closed.
 * Requests use the raw loaded snapshot and a confirmed profile revision. Changed source,
 * a newer confirmation or an old task update cannot replace the current evidence.
 * The owning visit notifies React; request locks and async records stay private here.
 */
import type { ApolloClient } from '@apollo/client'
import type { AiTaskStatusEnum, JobPreferencesQuery } from '@/graphql/generated/graphql'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { JOB_PREFERENCES_QUERY } from './jobPreferenceOperations'
import { CHECK_JOB_BOARD_PREFERENCE_RESULTS } from './preferenceCheckOperations'
import { boardPreferenceDecisions, orderByPreferences } from './preferenceAssessments'
import type { SearchSnapshot } from './jobBoardVisit'

type Profile = JobPreferencesQuery['jobPreferences']
type Identity = { scope: SearchSnapshot; revision?: number }
export type PreferenceCheckTask = { id: string; status: AiTaskStatusEnum; result: unknown; errorMessage?: string | null }
type Request = Identity & { profile: Profile; task: PreferenceCheckTask }

export function createJobBoardPreferenceCheck(client: ApolloClient, getSnapshot: () => SearchSnapshot, notify: () => void) {
  let active = false
  let request: Request | null = null
  let pending: Identity | null = null
  let failure: (Identity & { message: string }) | null = null
  let lock: Identity | null = null

  const revision = () => client.readQuery({ query: JOB_PREFERENCES_QUERY })?.jobPreferences.confirmedRevision
  const same = (value: Identity | null, confirmedRevision = revision()) => value?.scope === getSnapshot()
    && (value.revision === undefined || value.revision === confirmedRevision)

  async function check() {
    const snapshot = getSnapshot()
    if (same(lock) || !snapshot.listings.length || snapshot.listings.length > 100) return
    const operation: Identity = { scope: snapshot }
    lock = operation
    pending = operation
    failure = null
    notify()
    const isCurrent = () => operation.scope === getSnapshot()
      && (operation.revision === undefined || revision() === undefined || revision() === operation.revision)
    const fail = (message: string) => { if (isCurrent()) { failure = { ...operation, message }; notify() } }
    try {
      const profile = (await client.query({ query: JOB_PREFERENCES_QUERY, fetchPolicy: 'network-only' })).data?.jobPreferences
      if (!isCurrent()) return
      if (!profile?.confirmedCriteria.length) { fail('Confirm your preferences in “What I want next” before checking.'); return }
      operation.revision = profile.confirmedRevision
      active = true
      notify()
      const response = (await client.mutate({ mutation: CHECK_JOB_BOARD_PREFERENCE_RESULTS, variables: {
        confirmedRevision: profile.confirmedRevision,
        listings: snapshot.listings.map((listing) => ({ listingId: listing.id, expectedDigest: listing.preferenceSourceDigest })),
      } })).data?.checkJobBoardPreferenceResults
      if (!isCurrent()) return
      if (!response?.aiTask || response.errors.length) { fail(response?.errors.join(' ') || 'Could not start this check. Please try again.'); return }
      request = { ...operation, profile, task: response.aiTask }
      notify()
    } catch (cause) { fail(requestErrorMessage(cause, 'Could not check these results. Please try again.')) }
    finally {
      if (lock === operation) lock = null
      if (pending === operation) pending = null
      notify()
    }
  }

  function receive(task: PreferenceCheckTask) {
    if (task.status === 'QUEUED' || !request || request.task.id !== task.id || !same(request)) return
    request = { ...request, task }
    notify()
  }

  function getState(confirmedRevision = revision()) {
    const snapshot = getSnapshot()
    const current = request && same(request, confirmedRevision) ? request : null
    const task = current?.task
    const assessments = current && task?.status === 'COMPLETED' ? boardPreferenceDecisions(task.result, snapshot.listings, current.profile) : null
    return {
      active, assessments, profile: current?.profile,
      orderedListings: assessments && current ? orderByPreferences(snapshot.listings, assessments, current.profile) : snapshot.listings,
      completed: Boolean(assessments), stale: Boolean(request && !current),
      pending: same(pending, confirmedRevision), queued: task?.status === 'QUEUED',
      taskId: task?.status === 'QUEUED' ? task.id : '',
      error: (failure && same(failure, confirmedRevision) ? failure.message : null)
        || (task?.status === 'FAILED' ? task.errorMessage || 'The preference check failed. Please try again.' : null)
        || (task?.status === 'COMPLETED' && !assessments ? 'The check returned incomplete evidence. Please try again.' : null),
      limitReached: snapshot.listings.length > 100,
    }
  }
  return { check, receive, getState }
}
