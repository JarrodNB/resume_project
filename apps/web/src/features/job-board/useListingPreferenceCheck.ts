/** Keep one explicit assessment attached to the listing, search snapshot and confirmed revision. */
import { useLayoutEffect, useRef, useState } from 'react'
import { useApolloClient, useQuery, useSubscription } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import type { AiTaskStatusEnum, JobPreferencesQuery } from '@/graphql/generated/graphql'
import { JOB_PREFERENCES_QUERY } from './jobPreferenceOperations'
import { CHECK_JOB_BOARD_PREFERENCES, JOB_PREFERENCE_CHECK_SUBSCRIPTION } from './preferenceCheckOperations'
import type { BoardListing } from './useJobBoardSearch'

type Profile = JobPreferencesQuery['jobPreferences']
type CheckTask = { id: string; status: AiTaskStatusEnum; result: unknown; errorMessage?: string | null }
type Identity = { client: object; scope: object; digest: string }
function sameIdentity(left: Identity | null, right: Identity) { return left?.client === right.client && left.scope === right.scope && left.digest === right.digest }
type Request = Identity & { profile: Profile; task: CheckTask }
export type CriterionDecision = { id: string; status: 'matching' | 'conflicting' | 'unknown'; reason: string;
  support: { passage_id: string; text: string } | null; contradiction: { passage_id: string; text: string } | null }

export function preferenceDecisions(result: unknown, listing: BoardListing, profile: Profile): CriterionDecision[] | null {
  if (!result || typeof result !== 'object') return null
  const value = result as { confirmed_revision?: unknown; listings?: unknown }
  if (value.confirmed_revision !== profile.confirmedRevision || !Array.isArray(value.listings) || value.listings.length !== 1) return null
  const item = value.listings[0]
  if (!item || typeof item !== 'object' || item.id !== listing.id || item.source_digest !== listing.preferenceSourceDigest || !Array.isArray(item.criteria) || item.criteria.length !== profile.confirmedCriteria.length) return null
  const evidence = (value: unknown) => value === null || (typeof value === 'object' && value !== null && 'text' in value && typeof value.text === 'string' && 'passage_id' in value && typeof value.passage_id === 'string')
  if (!item.criteria.every((decision: CriterionDecision, index: number) => decision && decision.id === profile.confirmedCriteria[index].id && ['matching', 'conflicting', 'unknown'].includes(decision.status) && typeof decision.reason === 'string' && evidence(decision.support) && evidence(decision.contradiction))) return null
  return item.criteria
}

export function useListingPreferenceCheck(listing: BoardListing, scope: object) {
  const client = useApolloClient()
  const [active, setActive] = useState(false)
  const { data } = useQuery(JOB_PREFERENCES_QUERY, { skip: !active, fetchPolicy: 'cache-first' })
  const [request, setRequest] = useState<Request | null>(null)
  const [pending, setPending] = useState<Identity | null>(null)
  const [failure, setFailure] = useState<(Identity & { message: string }) | null>(null)
  const lock = useRef<Identity | null>(null)
  const identity = { client, scope, digest: listing.preferenceSourceDigest }
  const currentIdentity = useRef(identity)
  useLayoutEffect(() => { currentIdentity.current = identity })
  const error = failure && sameIdentity(failure, identity) ? failure.message : null
  const current = request?.client === client && request.scope === scope && request.digest === listing.preferenceSourceDigest && request.profile.confirmedRevision === data?.jobPreferences.confirmedRevision ? request : null
  const { data: live, error: subscriptionError } = useSubscription(JOB_PREFERENCE_CHECK_SUBSCRIPTION, {
    variables: { id: current?.task.id ?? '' }, skip: !current || current.task.status !== 'QUEUED',
  })
  const task = live?.aiTaskUpdated?.id === current?.task.id ? live?.aiTaskUpdated : current?.task
  const decisions = current && task?.status === 'COMPLETED' ? preferenceDecisions(task.result, listing, current.profile) : null

  async function check() {
    const operation = { client, scope, digest: listing.preferenceSourceDigest }
    if (sameIdentity(lock.current, operation)) return
    lock.current = operation
    setPending(operation)
    setFailure(null)
    const isCurrent = () => sameIdentity(currentIdentity.current, operation)
    const fail = (message: string) => { if (isCurrent()) setFailure({ ...operation, message }) }
    try {
      const profile = (await client.query({ query: JOB_PREFERENCES_QUERY, fetchPolicy: 'network-only' })).data?.jobPreferences
      if (!isCurrent()) return
      if (!profile?.confirmedCriteria.length) { fail('Confirm your preferences in “What I want next” before checking.'); return }
      setActive(true)
      const response = (await client.mutate({ mutation: CHECK_JOB_BOARD_PREFERENCES,
        variables: { listingId: listing.id, expectedDigest: listing.preferenceSourceDigest, confirmedRevision: profile.confirmedRevision } })).data?.checkJobBoardPreferences
      if (!isCurrent()) return
      if (!response?.aiTask || response.errors.length) { fail(response?.errors.join(' ') || 'Could not start this check. Please try again.'); return }
      setRequest({ client, scope, digest: listing.preferenceSourceDigest, profile, task: response.aiTask })
    } catch (cause) { fail(requestErrorMessage(cause, 'Could not check this listing. Please try again.')) }
    finally {
      if (lock.current === operation) lock.current = null
      setPending((value) => value === operation ? null : value)
    }
  }
  return { check, decisions, profile: current?.profile, stale: Boolean(request && !current),
    busy: sameIdentity(pending, identity) || (task?.status === 'QUEUED' && !subscriptionError),
    error: error || (task?.status === 'FAILED' ? task.errorMessage || 'The check failed. Please try again.' : null)
      || (task?.status === 'COMPLETED' && !decisions ? 'The check returned incomplete evidence. Please try again.' : null),
    disconnected: Boolean(subscriptionError) }
}
