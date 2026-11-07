/** Follows running AI work without polling so Home and Jobs can refresh their next steps.
 * Rechecks work when the browser becomes visible and reports tasks leaving the running list.
 */
import { useCallback, useEffect, useRef } from 'react'
import { useQuery } from '@apollo/client/react'
import { RUNNING_AI_TASKS_QUERY } from './homeOperations'

export function useRunningAiTasks(onWorkFinished: () => void) {
  const { data, error, refetch } = useQuery(RUNNING_AI_TASKS_QUERY, { fetchPolicy: 'cache-and-network' })
  const running = data?.runningAiTasks ?? []
  const previousIds = useRef<Set<string> | null>(null)
  const ids = running.map((task) => task.id).join(',')
  const checkAgain = useCallback(() => { void refetch().catch(() => { /* Keep the last known state. */ }) }, [refetch])

  useEffect(() => {
    if (!data) return
    const current = new Set(ids ? ids.split(',') : [])
    const finished = previousIds.current && [...previousIds.current].some((id) => !current.has(id))
    previousIds.current = current
    if (finished) onWorkFinished()
  }, [data, ids, onWorkFinished])

  useEffect(() => {
    function checkWhenVisible() { if (!document.hidden) void refetch().catch(() => { /* Keep the last known state. */ }) }
    document.addEventListener('visibilitychange', checkWhenVisible)
    return () => document.removeEventListener('visibilitychange', checkWhenVisible)
  }, [refetch])

  return { running, data, error, checkAgain }
}
