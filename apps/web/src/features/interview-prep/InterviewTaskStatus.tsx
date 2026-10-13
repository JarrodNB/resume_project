/**
 * Description: Restores and follows interview generation using the shared AI subscription.
 * Index: InterviewTaskStatus
 */
import { useEffect, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { useAiTaskUpdates } from '@/features/ai-tasks/useAiTaskUpdates'

interface TaskSnapshot { id: string; status: string; errorMessage?: string | null }

/** Follows task updates, shows generation progress, refreshes on completion, and displays failures. */
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
      {operation === 'generation' && current.status === 'QUEUED' && <div role="status" className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-5">
        <LoaderCircle className="size-5 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
        <div className="grid gap-1">
          <p className="font-medium">Generating your questions…</p>
          <p className="text-sm text-muted-foreground">We’re preparing five personalized questions from your career library. They’ll appear here when ready.</p>
        </div>
      </div>}
      {error && <ErrorAlert title="Live updates disconnected" messages={['Reload this page to check task status.']} />}
      {current.status === 'FAILED' && <ErrorAlert notificationId={current.id} title={operation === 'generation' ? 'Question generation failed' : operation === 'feedback' ? 'Answer feedback failed' : 'Question replacement failed'} messages={[current.errorMessage ?? 'Could not complete this task. Try again.']} />}
    </div>
  )
}
