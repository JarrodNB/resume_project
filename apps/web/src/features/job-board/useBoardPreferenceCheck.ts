/** Observe a visit's confirmed profile and reconnect its queued preference task.
 * The visit owns checks and their recovery. React only observes profile revisions
 * and transports live updates; opening or reordering results cannot start work.
 */
import { useQuery, useSubscription } from '@apollo/client/react'
import { JOB_PREFERENCES_QUERY } from './jobPreferenceOperations'
import { JOB_PREFERENCE_CHECK_SUBSCRIPTION } from './preferenceCheckOperations'
import type { JobBoardVisit } from './jobBoardVisit'

export function useBoardPreferenceCheck(visit: JobBoardVisit) {
  const { data } = useQuery(JOB_PREFERENCES_QUERY, { skip: !visit.getPreferenceCheck().active, fetchPolicy: 'cache-first' })
  const check = visit.getPreferenceCheck(data?.jobPreferences.confirmedRevision)
  const { error } = useSubscription(JOB_PREFERENCE_CHECK_SUBSCRIPTION, {
    variables: { id: check.taskId }, skip: !check.taskId,
    onData: ({ data }) => {
      if (data.data?.aiTaskUpdated) visit.receivePreferenceCheck(data.data.aiTaskUpdated)
    },
  })
  return {
    ...check, check: visit.checkPreferences,
    busy: check.pending || (check.queued && !error),
    disconnected: Boolean(check.taskId && error),
  }
}
