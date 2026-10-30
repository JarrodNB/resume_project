/** Connect a visit's queued ranking to React's live subscription lifecycle.
 * Ranking requests, results and retries belong to the visit, including while away.
 * A disconnected subscription displays provider order and reconnects to the same task on demand.
 */
import { useEffect } from 'react'
import { useSubscription } from '@apollo/client/react'
import { JOB_BOARD_RERANKING_SUBSCRIPTION } from './jobBoardOperations'
import type { JobBoardVisit } from './jobBoardVisit'

export function useJobBoardReranking(visit: JobBoardVisit) {
  const { snapshot } = visit.getState()
  const ranking = visit.getReranking()
  const { data, error, restart } = useSubscription(JOB_BOARD_RERANKING_SUBSCRIPTION, {
    variables: { id: ranking.taskId }, skip: !ranking.taskId,
  })
  useEffect(() => {
    if (data?.aiTaskUpdated) visit.receiveRanking(data.aiTaskUpdated)
  }, [visit, snapshot, data])

  const disconnected = Boolean(ranking.taskId && error)
  return {
    ...ranking,
    reconnect: restart,
    listings: disconnected ? snapshot.listings : ranking.listings,
    ranked: ranking.ranked && !disconnected,
    subscriptionError: disconnected ? 'Career-library ranking updates disconnected. Reconnect to recover the ranking.' : null,
  }
}
