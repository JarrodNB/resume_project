/** Watches one running task and reports when it leaves the queue. */
import { useEffect, useRef } from 'react'
import { useAiTaskUpdates } from '@/features/ai-tasks/useAiTaskUpdates'

/** The initial subscription state catches tasks completed before connecting. */
export function RunningTaskSubscription({ id, onSettled }: { id: string; onSettled: () => void }) {
  const { aiTask } = useAiTaskUpdates(id)
  const settled = aiTask !== null && aiTask.status !== 'QUEUED'
  const reported = useRef(false)
  useEffect(() => {
    if (settled && !reported.current) { reported.current = true; onSettled() }
  }, [settled, onSettled])
  return null
}
