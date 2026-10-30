/** Connect a visit's queued ranking to React's live subscription lifecycle.
 * Ranking requests, results and retries belong to the visit, including while away.
 * A disconnected subscription temporarily displays the provider's ordering.
 */
import { useEffect } from 'react'
import { useSubscription } from '@apollo/client/react'
import { JOB_BOARD_RERANKING_SUBSCRIPTION } from './jobBoardOperations'
import type { JobBoardVisit } from './jobBoardVisit'

export function useJobBoardReranking(visit: JobBoardVisit) {
  const { snapshot, rerankingEnabled } = visit.getState()
  const ranking = visit.getReranking()
  const { data, error } = useSubscription(JOB_BOARD_RERANKING_SUBSCRIPTION, {
    variables: { id: ranking.taskId }, skip: !ranking.taskId,
  })
  useEffect(() => { visit.startReranking() }, [visit, snapshot, rerankingEnabled])
  useEffect(() => {
    if (data?.aiTaskUpdated) visit.receiveRanking(data.aiTaskUpdated)
  }, [visit, snapshot, rerankingEnabled, data])

  return {
    ...ranking,
    listings: error ? snapshot.listings : ranking.listings,
    ranked: ranking.ranked && !error,
    subscriptionError: rerankingEnabled && error ? 'Reranking updates disconnected. Showing provider order until updates reconnect.' : null,
  }
}
