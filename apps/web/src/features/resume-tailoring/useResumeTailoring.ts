/**
 * Description: Loads the tailor page's job, offers an explicit target choice before starting a task, and
 * follows it live. Accepted tasks are history, not editable drafts. A saved resume
 * prevents generation and old-draft restoration for this visit, including when deletion
 * removes its cached link before the task's accepted timestamp reaches the cache.
 * Index:
 *   - TailorTaskView: the task fields the page renders
 *   - useResumeTailoring: job, task, start errors, and retry
 */
import { useCallback, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client/react'
import { useAiTaskUpdates } from '@/features/ai-tasks/useAiTaskUpdates'
import type { AiTaskStatusEnum } from '@/graphql/generated/graphql'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { START_RESUME_TAILORING_MUTATION, TAILOR_JOB_QUERY } from './tailorOperations'

export interface TailorTaskView {
  id: string
  status: AiTaskStatusEnum
  input: unknown
  result: unknown
  errorMessage: string | null
  acceptedAt: string | null
}

/** The job's tailoring task (live when one is running) and its saved resume. */
export function useResumeTailoring(jobId: string) {
  const { data, loading, error, refetch } = useQuery(TAILOR_JOB_QUERY, { variables: { id: jobId } })
  const [startTailoring, { loading: starting }] = useMutation(START_RESUME_TAILORING_MUTATION)
  const [startedTask, setStartedTask] = useState<TailorTaskView | null>(null)
  const [startErrors, setStartErrors] = useState<string[]>([])
  const [savedResumeJobId, setSavedResumeJobId] = useState<string | null>(null)
  const [targetPages, setTargetPages] = useState<1 | 2>(1)
  const job = data?.job ?? null
  // Remember this before a deletion cache update can remove the saved link.
  if (job?.resume && savedResumeJobId !== jobId) setSavedResumeJobId(jobId)
  const existing = job?.latestTailoring ?? null
  const hasSavedResume = Boolean(job?.resume) || savedResumeJobId === jobId
  const followExisting = Boolean(existing && existing.acceptedAt === null && (existing.status !== 'COMPLETED' || isMarkdownResult(existing.result)) && !hasSavedResume)
  const taskId = hasSavedResume ? '' : startedTask?.id ?? (followExisting && existing ? existing.id : '')
  const initialTask = startedTask ?? (followExisting ? existing : null)
  const terminal = initialTask?.status === 'COMPLETED' || initialTask?.status === 'FAILED'
  const { aiTask, error: subscriptionError } = useAiTaskUpdates(terminal ? '' : taskId)

  const begin = useCallback(async (requestedPages: 1 | 2 = targetPages) => {
    setStartErrors([])
    try {
      const { data: startedData } = await startTailoring({ variables: { jobId, targetPages: requestedPages } })
      const payload = startedData?.startResumeTailoring
      if (payload?.aiTask && payload.errors.length === 0) {
        setStartedTask(taskFrom(payload.aiTask))
        return
      }
      setStartErrors(payload?.errors.length ? payload.errors : ["Couldn't start the resume. Please try again."])
    } catch (startError) {
      setStartErrors([requestErrorMessage(startError, "Couldn't reach the server. Check your connection and try again.")])
    }
  }, [jobId, targetPages, startTailoring])

  /** Starts a new attempt only after an explicit target choice. */
  function retry() {
    void begin(targetFrom(task?.input) ?? targetFrom(task?.result) ?? targetPages)
  }

  const task = hasSavedResume ? null : (aiTask?.id === taskId ? taskFrom(aiTask) : null) ?? startedTask ?? taskFrom(followExisting ? existing : null)
  return { job, task, loading, error, startErrors, subscriptionError, retry, refetch,
    activeTargetPages: targetFrom(task?.result) ?? targetFrom(task?.input) ?? 1,
    starting, targetPages, setTargetPages, twoPageEligible: data?.resumeTwoPageEligible === true, begin }
}

function targetFrom(value: unknown): 1 | 2 | null {
  return typeof value === 'object' && value !== null && 'target_pages' in value && (value.target_pages === 1 || value.target_pages === 2) ? value.target_pages : null
}

function isMarkdownResult(result: unknown): boolean {
  return typeof result === 'object' && result !== null && 'markdown' in result && typeof result.markdown === 'string' && 'target_pages' in result && (result.target_pages === 1 || result.target_pages === 2)
}

/** Copies the fields the page reads off a query task or a subscription task. */
function taskFrom(source: {
  id: string
  status: AiTaskStatusEnum
  input?: unknown
  result?: unknown
  errorMessage?: string | null
  acceptedAt?: string | null
} | null): TailorTaskView | null {
  if (!source) return null
  return {
    id: source.id,
    status: source.status,
    input: source.input ?? null,
    result: source.result ?? null,
    errorMessage: source.errorMessage ?? null,
    acceptedAt: source.acceptedAt ?? null,
  }
}
