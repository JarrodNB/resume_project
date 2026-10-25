/** Follows the signed-in owner's outcome feed independently of feature-page lifetime.
 * Occurrence IDs distinguish a new outcome after retry from duplicate delivery. */
import { useRef, useState } from 'react'
import { useSubscription } from '@apollo/client/react'
import type { TaskOutcomeSubscription } from '@/graphql/generated/graphql'
import { TASK_OUTCOME_SUBSCRIPTION } from './taskNotificationOperations'

export type TaskNotice = NonNullable<TaskOutcomeSubscription['aiTaskFinished']['outcome']>

/** Mount with a new key for each account so private notices never cross sessions. */
export function useTaskNotifications(userId: string) {
  const handled = useRef(new Set<string>())
  const [notices, setNotices] = useState<TaskNotice[]>([])
  useSubscription(TASK_OUTCOME_SUBSCRIPTION, {
    skip: userId === '',
    onData({ data }) {
      const outcome = data.data?.aiTaskFinished.outcome
      if (!outcome || handled.current.has(outcome.id)) return
      handled.current.add(outcome.id)
      setNotices((current) => [...current, outcome])
    },
  })
  return {
    notices,
    dismiss: (id: string) => setNotices((current) => current.filter((notice) => notice.id !== id)),
  }
}
