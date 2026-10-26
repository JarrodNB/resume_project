/** Keeps rendered notices local to one signed-in account and Apollo session.
 * Feed recovery and cross-tab delivery live together in followTaskOutcomes. */
import { useEffect, useState } from 'react'
import { useApolloClient } from '@apollo/client/react'
import { followTaskOutcomes, type TaskNotice } from './followTaskOutcomes'

/** Mount with a new key for each account so private notices never cross sessions. */
export function useTaskNotifications(userId: string, initialCursor?: string | null) {
  const client = useApolloClient()
  const [notices, setNotices] = useState<TaskNotice[]>([])
  useEffect(() => {
    if (!userId) return
    return followTaskOutcomes(client, userId, initialCursor, (notice) => {
      setNotices((current) => current.some((item) => item.id === notice.id) ? current : [...current, notice])
    })
  }, [client, userId, initialCursor])
  return { notices, dismiss: (id: string) => setNotices((current) => current.filter((notice) => notice.id !== id)) }
}
