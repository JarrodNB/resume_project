/** Follow saved references for one exact prompt without changing interview progress or answer drafts.
 * Visit receipts permit one refresh on resume. Pending work uses task subscriptions;
 * a saved deadline permits explicit recovery without polling.
 */
import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@apollo/client/react'
import { useAiTaskUpdates } from '@/features/ai-tasks/useAiTaskUpdates'
import type { InterviewSnapshotFragment } from '@/graphql/generated/graphql'
import { REQUEST_INTERVIEW_REFERENCES } from './interviewOperations'

type SavedReferences = InterviewSnapshotFragment['messages'][number]['careerReferences']
type CareerReference = NonNullable<SavedReferences>['references'][number]

/** Task results use worker field names; the saved GraphQL record uses client field names. */
function taskReferences(result: unknown): CareerReference[] | null {
  if (!result || typeof result !== 'object' || !('references' in result) || !Array.isArray(result.references)) return null
  const references: CareerReference[] = []
  for (const value of result.references) {
    if (!value || typeof value !== 'object' || typeof value.source_type !== 'string' || typeof value.source_id !== 'string' ||
      typeof value.title !== 'string' || typeof value.body !== 'string') return null
    references.push({ sourceType: value.source_type, sourceId: value.source_id, title: value.title, body: value.body })
  }
  return references
}

export function useInterviewCareerReferences(interviewId: string, messageId: string, saved: SavedReferences, visitId?: string) {
  const [local, setLocal] = useState<SavedReferences>(null)
  const record = local && (!saved || local.attemptCount > saved.attemptCount) ? local : saved
  const [request, { loading }] = useMutation(REQUEST_INTERVIEW_REFERENCES)
  const [error, setError] = useState<string | null>(null)
  const [expiredKey, setExpiredKey] = useState<string | null>(null)
  const recordKey = record ? `${record.id}:${record.attemptCount}` : null
  const expired = recordKey !== null && expiredKey === recordKey
  const locked = useRef(false)
  const [visitUnconfirmed, setVisitUnconfirmed] = useState(Boolean(visitId))
  const savedComplete = record?.status === 'completed' || record?.status === 'empty'
  const { aiTask, error: subscriptionError } = useAiTaskUpdates(savedComplete ? '' : record?.aiTaskId ?? '')
  const currentTask = aiTask?.id === record?.aiTaskId ? aiTask : null
  const fromTask = currentTask?.status === 'COMPLETED' ? taskReferences(currentTask.result) : null
  const complete = savedComplete || fromTask !== null
  const references = savedComplete ? record.references : fromTask ?? []
  const failed = !complete && (expired || record?.status === 'failed' || currentTask?.status === 'FAILED')
  const pending = !complete && !failed && Boolean(record)

  useEffect(() => {
    if (!record?.deadline || complete || !recordKey) return
    const timer = window.setTimeout(() => setExpiredKey(recordKey), Math.min(2_147_483_647, Math.max(0, Date.parse(record.deadline) - Date.now())))
    return () => window.clearTimeout(timer)
  }, [recordKey, record?.deadline, complete])

  async function retrieve(retryFailed = false, resume = false) {
    const checkVisit = resume || (retryFailed && visitUnconfirmed)
    if (locked.current || (!checkVisit && (complete || pending))) return
    locked.current = true
    setError(null)
    try {
      const response = await request({ variables: { input: { interviewId, messageId, retryFailed, ...(visitId ? { visitId } : {}) } } })
      const payload = response.data?.requestInterviewReferences
      if (payload?.errors.length || !payload?.careerReferences) {
        setError(payload?.errors.join('. ') || 'Could not request career examples. Please retry.')
      } else {
        setVisitUnconfirmed(false)
        setExpiredKey(null)
        setLocal(payload.careerReferences)
      }
    } catch {
      setError('Could not confirm career examples. Retry to check their saved status.')
    } finally { locked.current = false }
  }
  return { retrieve, references, complete, pending: pending || loading, failed, canRetry: Boolean(error && visitUnconfirmed) || (record?.canRetry ?? true),
    error: error || (failed ? currentTask?.errorMessage || 'Career examples did not finish. Please retry.' : null),
    subscriptionError: subscriptionError ? 'Live career example updates disconnected. Reopen this interview to check saved status.' : null }
}
