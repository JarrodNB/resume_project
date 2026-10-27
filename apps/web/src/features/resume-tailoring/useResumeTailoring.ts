/**
 * Description: Loads a job's resume and tailoring task and follows the task live. With
 * `autoStart`, it starts a tailor task when there isn't one (the write route); without it
 * (the Resume tab) it never starts paid generation on its own. Accepted tasks are history, not editable drafts. A saved resume
 * prevents generation and old-draft restoration for this visit, including when deletion
 * removes its cached link before the task's accepted timestamp reaches the cache.
 * Index:
 *   - TailorTaskView: the task fields the page renders
 *   - useResumeTailoring: job, task, start errors, and retry
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client/react'
import { useAiTaskUpdates } from '@/features/ai-tasks/useAiTaskUpdates'
import type { AiTaskStatusEnum } from '@/graphql/generated/graphql'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { finishedSectionsFromResult } from './parseTailorTask'
import { START_RESUME_TAILORING_MUTATION, TAILOR_JOB_QUERY } from './tailorOperations'

export interface TailorTaskView {
  id: string
  status: AiTaskStatusEnum
  result: unknown
  errorMessage: string | null
  acceptedAt: string | null
}

/** The job's tailoring task (live when one is running) and its saved resume. */
export function useResumeTailoring(jobId: string, { autoStart = true }: { autoStart?: boolean } = {}) {
  const { data, loading, error, refetch } = useQuery(TAILOR_JOB_QUERY, { variables: { id: jobId } })
  const [startTailoring] = useMutation(START_RESUME_TAILORING_MUTATION)
  const [startedTask, setStartedTask] = useState<TailorTaskView | null>(null)
  const [startErrors, setStartErrors] = useState<string[]>([])
  const [savedResumeJobId, setSavedResumeJobId] = useState<string | null>(null)
  const started = useRef(false)
  const job = data?.job ?? null
  // Remember this before a deletion cache update can remove the saved link.
  if (job?.resume && savedResumeJobId !== jobId) setSavedResumeJobId(jobId)
  const existing = job?.latestTailoring ?? null
  const hasSavedResume = Boolean(job?.resume) || savedResumeJobId === jobId
  const usableExisting = Boolean(existing && (existing.status !== 'COMPLETED' || finishedSectionsFromResult(existing.result).length > 0))
  const followExisting = Boolean(existing && usableExisting && existing.acceptedAt === null && existing.status !== 'FAILED' && !hasSavedResume)
  const taskId = hasSavedResume ? '' : startedTask?.id ?? (followExisting && existing ? existing.id : '')
  const { aiTask, error: subscriptionError } = useAiTaskUpdates(taskId)

  const begin = useCallback(async () => {
    setStartErrors([])
    try {
      const { data: startedData } = await startTailoring({ variables: { jobId } })
      const payload = startedData?.startResumeTailoring
      if (payload?.aiTask && payload.errors.length === 0) {
        setStartedTask(taskFrom(payload.aiTask))
        return
      }
      setStartErrors(payload?.errors.length ? payload.errors : ["Couldn't start the resume. Please try again."])
    } catch (startError) {
      setStartErrors([requestErrorMessage(startError, "Couldn't reach the server. Check your connection and try again.")])
    }
  }, [jobId, startTailoring])

  useEffect(() => {
    // Deleting the saved resume must not turn this visit into a generation request.
    if (job?.resume) started.current = true
    if (!autoStart || loading || !job || job.resume || (job.latestTailoring && !job.latestTailoring.acceptedAt && usableExisting) || started.current) return
    started.current = true
    void begin()
  }, [autoStart, loading, job, jobId, begin, usableExisting])

  /** Starts again after a failed task. */
  function retry() {
    started.current = true
    void begin()
  }

  const task = hasSavedResume ? null : (aiTask?.id === taskId ? taskFrom(aiTask) : null) ?? startedTask ?? taskFrom(existing?.acceptedAt || !usableExisting ? null : existing)
  return { job, task, loading, error, startErrors, subscriptionError, retry, refetch }
}

/** Copies the fields the page reads off a query task or a subscription task. */
function taskFrom(source: {
  id: string
  status: AiTaskStatusEnum
  result?: unknown
  errorMessage?: string | null
  acceptedAt?: string | null
} | null): TailorTaskView | null {
  if (!source) return null
  return {
    id: source.id,
    status: source.status,
    result: source.result ?? null,
    errorMessage: source.errorMessage ?? null,
    acceptedAt: source.acceptedAt ?? null,
  }
}
