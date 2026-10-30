/** Connect a visit's queued ranking to React's live subscription lifecycle.
 * Ranking requests, results and retries belong to the visit, including while away.
 * A disconnected subscription temporarily displays the provider's ordering.
 */
import { useEffect } from 'react'
import { useSubscription } from '@apollo/client/react'
import { JOB_BOARD_RERANKING_SUBSCRIPTION } from './jobBoardOperations'
import type { JobBoardVisit } from './jobBoardVisit'

export function useJobBoardReranking(visit: JobBoardVisit) {
  const { snapshot } = visit.getState()
  const ranking = visit.getReranking()
  const { data, error } = useSubscription(JOB_BOARD_RERANKING_SUBSCRIPTION, {
    variables: { id: ranking.taskId }, skip: !ranking.taskId,
  })
  useEffect(() => {
    if (data?.aiTaskUpdated) visit.receiveRanking(data.aiTaskUpdated)
  }, [visit, snapshot, data])

  return {
    ...ranking,
    listings: error ? snapshot.listings : ranking.listings,
    ranked: ranking.ranked && !error,
    subscriptionError: error ? 'Career-library ranking updates disconnected. Reconnect or retry to recover the ranking.' : null,
  }
}
