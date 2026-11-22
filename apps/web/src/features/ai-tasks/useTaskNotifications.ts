/** Keeps rendered notices local to one signed-in account and Apollo session.
 * Feed recovery and cross-tab delivery live together in followTaskOutcomes.
 * Spoken-interview outcomes are never shown, and an outcome is skipped when the user is
 * already on the page it would open (checked when it arrives, so a hidden tab judges
 * by where the user is when they come back). */
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { useApolloClient } from '@apollo/client/react'
import { followTaskOutcomes, type TaskNotice } from './followTaskOutcomes'

// Matches the spoken-interview destinations built in services/api/app/services/ai_tasks/describe_task_outcome_service.rb.
const INTERVIEW_PATH = '/practice/interviews'

function pathOf(destination: string) {
  return destination.split(/[?#]/)[0].replace(/(.)\/$/, '$1')
}

function shouldSuppressNotice(notice: TaskNotice, currentPath: string) {
  const path = pathOf(notice.destination)
  return path === INTERVIEW_PATH || path.startsWith(`${INTERVIEW_PATH}/`) || path === currentPath
}

/** Mount with a new key for each account so private notices never cross sessions. */
export function useTaskNotifications(userId: string, initialCursor?: string | null) {
  const client = useApolloClient()
  const [notices, setNotices] = useState<TaskNotice[]>([])
  const currentPath = useRef('')
  currentPath.current = pathOf(useLocation().pathname)
  useEffect(() => {
    if (!userId) return
    return followTaskOutcomes(client, userId, initialCursor, (notice) => {
      if (shouldSuppressNotice(notice, currentPath.current)) return
      setNotices((current) => current.some((item) => item.id === notice.id) ? current : [...current, notice])
    })
  }, [client, userId, initialCursor])
  return {
    notices,
    dismiss: (id: string) => setNotices((current) => current.filter((notice) => notice.id !== id)),
    clearAll: () => setNotices([]),
  }
}
