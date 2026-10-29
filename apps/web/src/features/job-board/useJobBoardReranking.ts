/** Internal ordering for the search module's immutable result snapshot.
 * The snapshot itself is the identity: ranking never reconstructs it from caller values.
 * Requests are cached for this page visit so switching off and on does not repeat work.
 * Late mutations/subscriptions stay attached to their snapshot, never a newer search.
 */
import { useEffect, useState } from 'react'
import { useApolloClient, useSubscription } from '@apollo/client/react'
import type { AiTaskStatusEnum } from '@/graphql/generated/graphql'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { JOB_BOARD_RERANKING_SUBSCRIPTION, RERANK_JOB_BOARD_LISTINGS_MUTATION } from './jobBoardOperations'
import type { JobBoardVisit } from './useJobBoardVisit'
import type { BoardListing } from './useJobBoardSearch'

interface RerankingTask { id: string; status: AiTaskStatusEnum; result: unknown; errorMessage?: string | null }
export interface RerankingRequest { starting: boolean; task?: RerankingTask; error?: string; order?: string[] }
interface Snapshot { submitted: { keyword: string } | null; listings: BoardListing[] }

/** Only a complete permutation can replace the provider order. */
function resultOrder(result: unknown, ids: string[]): string[] | null {
  if (typeof result !== 'object' || result === null || !('ranked_listing_ids' in result)) return null
  const order = result.ranked_listing_ids
  return Array.isArray(order) && order.length === ids.length && new Set(order).size === ids.length
    && order.every((id): id is string => typeof id === 'string' && ids.includes(id)) ? order : null
}

export function useJobBoardReranking(enabled: boolean, snapshot: Snapshot, visit: JobBoardVisit) {
  const { listings } = snapshot
  const keyword = snapshot.submitted?.keyword ?? ''
  const client = useApolloClient()
  const requests = visit.requests
  const refresh = () => visit.update((state) => ({ rankingRevision: state.rankingRevision + 1 }))
  const [attempt, setAttempt] = useState(0)
  const ids = listings.map((listing) => listing.id)
  const available = ids.length > 0 && ids.length <= 100
  const current = requests.get(snapshot)
  const taskId = enabled && available && current?.task?.status === 'QUEUED' ? current.task.id : ''
  const { data, error: subscriptionError } = useSubscription(JOB_BOARD_RERANKING_SUBSCRIPTION, {
    variables: { id: taskId }, skip: !taskId,
  })

  useEffect(() => {
    if (!enabled || !available || !keyword || requests.has(snapshot)) return
    const request: RerankingRequest = { starting: true }
    requests.set(snapshot, request)
    // A page visit keeps only a small history; in-flight callbacks retain their own record.
    if (requests.size > 10) requests.delete(requests.keys().next().value!)
    refresh()
    void client.mutate({ mutation: RERANK_JOB_BOARD_LISTINGS_MUTATION, variables: { keyword, listingIds: ids } }).then(({ data }) => {
      const payload = data?.rerankJobBoardListings
      if (!payload?.aiTask || payload.errors.length) request.error = payload?.errors.join(' ') || 'Could not start reranking. Please try again.'
      else {
        request.task = payload.aiTask
        if (payload.aiTask.status === 'COMPLETED') {
          request.order = resultOrder(payload.aiTask.result, ids) ?? undefined
          if (!request.order) request.error = 'The reranking result was incomplete. Please try again.'
        }
      }
    }).catch((error: unknown) => {
      request.error = requestErrorMessage(error, 'Could not start reranking. Please try again.')
    }).finally(() => {
      request.starting = false
      refresh()
    })
    // Search creates a new immutable snapshot on submission or accepted provider pages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, available, snapshot, client, requests, attempt])

  useEffect(() => {
    const update = data?.aiTaskUpdated
    const request = requests.get(snapshot)
    if (!enabled || !request?.task || update?.id !== request.task.id) return
    request.task = update
    if (update.status === 'COMPLETED') {
      request.order = resultOrder(update.result, ids) ?? undefined
      if (!request.order) request.error = 'The reranking result was incomplete. Please try again.'
    }
    if (update.status === 'FAILED') request.error = update.errorMessage || 'Could not rerank these jobs. Please try again.'
    refresh()
    // Snapshot identity also determines the exact expected result IDs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, snapshot, data, requests])

  // A task may already be complete in the mutation response, before subscribing.
  const task = current?.task
  const order = current?.order ?? (task?.status === 'COMPLETED' ? resultOrder(task.result, ids) : null)
  const error = current?.error ?? (task?.status === 'FAILED' ? task.errorMessage || 'Could not rerank these jobs. Please try again.' : null)
  const busy = enabled && available && !error && !order && (!current || current.starting || task?.status === 'QUEUED')
  const byId = new Map(listings.map((listing) => [listing.id, listing]))
  const ranked = enabled && available && order && !error && !subscriptionError
  const displayed = ranked ? order.map((id) => byId.get(id)!) : listings

  function retry() {
    if (busy) return
    requests.delete(snapshot)
    setAttempt((value) => value + 1)
  }

  return {
    listings: displayed, busy, ranked: Boolean(ranked),
    error: enabled && available ? error : null,
    subscriptionError: enabled && subscriptionError ? 'Reranking updates disconnected. Showing provider order until updates reconnect.' : null,
    limitReached: enabled && ids.length > 100,
    retry,
  }
}
