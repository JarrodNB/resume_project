/** Follows explicitly requested coaching through saved interview state and task updates. */
import { useRef, useState } from 'react'
import { useMutation } from '@apollo/client/react'
import { useAiTaskUpdates } from '@/features/ai-tasks/useAiTaskUpdates'
import type { InterviewSnapshotFragment } from '@/graphql/generated/graphql'
import { REQUEST_INTERVIEW_SESSION_FEEDBACK } from './interviewOperations'
import { useInterviewDeadline } from './useInterviewDeadline'

export type SavedSessionFeedback = InterviewSnapshotFragment['feedback']
export type SessionFeedbackContent = {
  summary: string
  questions: { question_id: string; strengths: string[]; improvements: string[]; example_answer: string }[]
}

export function useInterviewSessionFeedback(interviewId: string, saved: SavedSessionFeedback) {
  const [local, setLocal] = useState<SavedSessionFeedback>(null)
  const record = local && (!saved || local.attemptCount > saved.attemptCount) ? local : saved
  const [request, { loading }] = useMutation(REQUEST_INTERVIEW_SESSION_FEEDBACK)
  const [error, setError] = useState<string | null>(null)
  const locked = useRef(false)
  const { aiTask, error: subscriptionError } = useAiTaskUpdates(record?.aiTaskId ?? '')
  const task = aiTask?.id === record?.aiTaskId ? aiTask : null
  // Rails validates the structure and exact question identities before publishing completed work.
  const stored = record?.content as SessionFeedbackContent | null
  const result = task?.result as { interview_session_feedback?: SessionFeedbackContent } | null
  const content = stored?.summary ? stored : task?.status === 'COMPLETED' ? result?.interview_session_feedback ?? null : null
  const expired = useInterviewDeadline(record?.deadline)
  const failed = !content && (expired || record?.status === 'failed' || task?.status === 'FAILED')
  const pending = !content && !failed && Boolean(record)

  async function generate(retryFailed = false) {
    if (locked.current || content || pending) return
    locked.current = true
    setError(null)
    try {
      const response = await request({ variables: { input: { interviewId, retryFailed } } })
      const payload = response.data?.requestInterviewSessionFeedback
      if (payload?.feedback) setLocal(payload.feedback)
      if (payload?.errors.length || !payload?.feedback) setError(payload?.errors.join('. ') || 'Could not request feedback. Please retry.')
    } catch {
      setError('Could not confirm feedback. Retry to check its saved status.')
    } finally { locked.current = false }
  }

  return { generate, content, pending: pending || loading, failed,
    canRetry: (record?.attemptCount ?? 0) < 2,
    error: error || (failed ? task?.errorMessage || 'Feedback did not finish. Please retry.' : null),
    subscriptionError: subscriptionError ? 'Live feedback updates disconnected. Reopen this interview to check saved status.' : null }
}
