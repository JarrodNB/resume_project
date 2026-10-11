/**
 * Description: Restores and follows interview generation using the shared AI subscription.
 * Index: InterviewTaskStatus
 */
import { useEffect, useRef, useState } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { useAiTaskUpdates } from '@/features/ai-tasks/useAiTaskUpdates'

interface TaskSnapshot { id: string; status: string; errorMessage?: string | null }

/** Follows task updates, refreshes on completion, and displays failure alerts. */
export function InterviewTaskStatus({ task, onFinished, operation = 'generation' }: { task: TaskSnapshot; onFinished: () => unknown; operation?: 'generation' | 'feedback' | 'replacement' }) {
  // Keep following through Apollo's normalized terminal-state update until refetch completes.
  const [subscriptionId] = useState(task.status === 'QUEUED' ? task.id : '')
  const { aiTask, error } = useAiTaskUpdates(subscriptionId)
  const current = aiTask?.id === task.id ? aiTask : task
  const refreshed = useRef('')
  useEffect(() => {
    if (aiTask?.id === task.id && (aiTask.status === 'COMPLETED' || aiTask.status === 'FAILED') && refreshed.current !== aiTask.id) {
      refreshed.current = aiTask.id
      void Promise.resolve(onFinished()).catch(() => { /* The owning query reports refresh errors. */ })
    }
  }, [aiTask, task.id, onFinished])
  return (
    <div className="grid gap-2" aria-live="polite">
      {error && <ErrorAlert title="Live updates disconnected" messages={['Reload this page to check task status.']} />}
      {current.status === 'FAILED' && <ErrorAlert notificationId={current.id} title={operation === 'generation' ? 'Question generation failed' : operation === 'feedback' ? 'Answer feedback failed' : 'Question replacement failed'} messages={[current.errorMessage ?? 'Could not complete this task. Try again.']} />}
    </div>
  )
}
