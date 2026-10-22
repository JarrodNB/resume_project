/** Follow one saved prompt's explanation through the task subscription, without touching its answer draft. */
import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@apollo/client/react'
import { useAiTaskUpdates } from '@/features/ai-tasks/useAiTaskUpdates'
import type { InterviewSnapshotFragment } from '@/graphql/generated/graphql'
import { REQUEST_INTERVIEW_CLARIFICATION } from './interviewOperations'

type SavedClarification = InterviewSnapshotFragment['messages'][number]['clarification']

export function useInterviewClarification(interviewId: string, messageId: string, saved: SavedClarification) {
  const [local, setLocal] = useState<SavedClarification>(null)
  const record = local && (!saved || local.attemptCount > saved.attemptCount) ? local : saved
  const [request, { loading }] = useMutation(REQUEST_INTERVIEW_CLARIFICATION)
  const [error, setError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  const locked = useRef(false)
  const { aiTask, error: subscriptionError } = useAiTaskUpdates(record?.aiTaskId ?? '')
  const currentTask = aiTask?.id === record?.aiTaskId ? aiTask : null
  const result = currentTask?.status === 'COMPLETED' ? currentTask.result as { explanation?: unknown } | null : null
  const explanation = record?.explanation || (typeof result?.explanation === 'string' ? result.explanation : null)
  const failed = !explanation && (expired || record?.status === 'failed' || currentTask?.status === 'FAILED')
  const pending = !explanation && !failed && Boolean(record)

  useEffect(() => {
    if (!record?.deadline || explanation) return
    const timer = window.setTimeout(() => setExpired(true), Math.min(2_147_483_647, Math.max(0, Date.parse(record.deadline) - Date.now())))
    return () => window.clearTimeout(timer)
  }, [record?.deadline, explanation])

  async function clarify(retryFailed = false) {
    if (locked.current || explanation || (pending && !retryFailed)) return
    locked.current = true
    setError(null)
    try {
      const response = await request({ variables: { input: { interviewId, messageId, retryFailed } } })
      const payload = response.data?.requestInterviewClarification
      if (payload?.errors.length || !payload?.clarification) {
        setError(payload?.errors.join('. ') || 'Could not request clarification. Please retry.')
      } else {
        setExpired(false)
        setLocal(payload.clarification)
      }
    } catch {
      setError('Could not confirm clarification. Retry to check its saved status.')
    } finally { locked.current = false }
  }
  return { clarify, explanation, pending: pending || loading, failed, canRetry: (record?.attemptCount ?? 0) < 2,
    error: error || (failed ? currentTask?.errorMessage || 'Clarification did not finish. Please retry.' : null),
    subscriptionError: subscriptionError ? 'Live clarification updates disconnected. Reopen this interview to check saved status.' : null }
}
