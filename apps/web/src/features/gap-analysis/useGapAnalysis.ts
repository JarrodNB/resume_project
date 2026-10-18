/** Owns one job's comparison request and live task state for all controls on the job page.
 * An unfinished task stays busy even when its subscription disconnects.
 */
import { useRef, useState } from 'react'
import type { AiTaskStatusEnum } from '@/graphql/generated/graphql'
import { useAiTaskUpdates } from '@/features/ai-tasks/useAiTaskUpdates'
import { useStartGapAnalysis } from './useStartGapAnalysis'

export interface GapAnalysisTask {
  id: string
  status: AiTaskStatusEnum
  result: unknown
  errorMessage: string | null
  createdAt: string
}

function isActive(task: GapAnalysisTask | null) {
  return task !== null && task.status !== 'COMPLETED' && task.status !== 'FAILED'
}

/** Starts at most one request and shares its current outcome with the card and resume action. */
export function useGapAnalysis(jobId: string, latestTask: GapAnalysisTask | null) {
  const { startGapAnalysis, starting, errors } = useStartGapAnalysis(jobId)
  const [startedTask, setStartedTask] = useState<{ id: string; previousTaskId: string | null } | null>(null)
  const requesting = useRef(false)
  // The local task bridges the mutation-to-cache interval. Once the job names a new
  // latest task, that identity owns selection (including work started in another tab).
  const localTaskId = startedTask && (latestTask?.id ?? null) === startedTask.previousTaskId ? startedTask.id : null
  const followedId = localTaskId ?? (latestTask && isActive(latestTask) ? latestTask.id : '')
  const { aiTask, error: subscriptionError } = useAiTaskUpdates(followedId)
  const task: GapAnalysisTask | null = followedId
    ? (aiTask?.id === followedId ? aiTask : latestTask?.id === followedId ? latestTask : {
      id: followedId, status: 'QUEUED', result: null, errorMessage: null, createdAt: '',
    })
    : latestTask
  const busy = starting || isActive(task)

  async function start() {
    if (requesting.current || busy) return
    requesting.current = true
    try {
      const id = await startGapAnalysis()
      if (id) setStartedTask({ id, previousTaskId: latestTask?.id ?? null })
    } finally {
      requesting.current = false
    }
  }

  return { task, starting, errors, subscriptionError, busy, completed: task?.status === 'COMPLETED', start }
}
