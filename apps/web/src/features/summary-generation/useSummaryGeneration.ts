/** Restores server-owned summary work and follows it live; only explicit actions mutate it. */
import { useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client/react'
import { useAiTaskUpdates } from '@/features/ai-tasks/useAiTaskUpdates'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import type { SummaryGenerationQuery } from '@/graphql/generated/graphql'
import { SUMMARY_GENERATION_QUERY, START_SUMMARY_GENERATION_MUTATION, ACCEPT_SUMMARY_GENERATION_MUTATION, DISCARD_SUMMARY_GENERATION_MUTATION } from './summaryGenerationOperations'

type SummaryTask = NonNullable<SummaryGenerationQuery['summaryGeneration']['aiTask']>

export function useSummaryGeneration(targetKind: string, targetId?: string, onAccepted?: () => void | Promise<unknown>) {
  const { data, loading, error, refetch } = useQuery(SUMMARY_GENERATION_QUERY, { variables: { targetKind, targetId }, fetchPolicy: 'network-only' })
  const [submitted, setSubmitted] = useState<SummaryTask | null>(null)
  const [messages, setMessages] = useState<string[]>([])
  const [start, startState] = useMutation(START_SUMMARY_GENERATION_MUTATION)
  const [accept, acceptState] = useMutation(ACCEPT_SUMMARY_GENERATION_MUTATION)
  const [discard, discardState] = useMutation(DISCARD_SUMMARY_GENERATION_MUTATION)
  const saved = data?.summaryGeneration.aiTask
  let base = submitted ?? saved
  if (saved?.id === base?.id && base?.status === 'QUEUED' && saved?.status !== 'QUEUED') base = saved
  const { aiTask: live, error: liveError } = useAiTaskUpdates(base?.id ?? '')
  // A delayed queued event cannot replace a known terminal/accepted outcome.
  const task = base?.status === 'QUEUED' && live?.id === base.id ? live : base
  const pending = useRef(false)
  const saving = startState.loading || acceptState.loading || discardState.loading
  const stale = !!data?.summaryGeneration.stale && (!submitted || submitted.id === data.summaryGeneration.aiTask?.id)

  async function generate() {
    if (pending.current || loading || task?.status === 'QUEUED') return
    pending.current = true
    setMessages([])
    try {
      const response = await start({ variables: { targetKind, targetId } })
      const payload = response.data?.startSummaryGeneration
      setMessages(payload?.errors ?? ['Could not generate a summary. Try again.'])
      if (payload?.aiTask) setSubmitted(payload.aiTask)
    } catch (failure) {
      setMessages([requestErrorMessage(failure, 'Could not generate a summary. Try again.')])
    } finally { pending.current = false }
  }

  async function finish(text?: string, discardDraft = false) {
    if (!task || pending.current || (!discardDraft && (stale || task.status !== 'COMPLETED'))) return
    pending.current = true
    setMessages([])
    try {
      let payload
      if (discardDraft) {
        const response = await discard({ variables: { aiTaskId: task.id } })
        payload = response.data?.discardSummaryGeneration
      } else {
        const response = await accept({ variables: { aiTaskId: task.id, text: text ?? '' } })
        payload = response.data?.acceptSummaryGeneration
      }
      setMessages(payload?.errors ?? ['Could not save this action. Try again.'])
      if (payload?.aiTask && !payload.errors.length) {
        setSubmitted(payload.aiTask)
        if (!discardDraft) {
          try { await onAccepted?.() } catch { setMessages(['Summary saved. Refresh the page to see it.']) }
        }
      }
    } catch (failure) {
      setMessages([requestErrorMessage(failure, 'Could not save this action. Try again.')])
    } finally { pending.current = false }
  }

  async function refresh() {
    setMessages([])
    try {
      const response = await refetch()
      setSubmitted(response.data?.summaryGeneration.aiTask ?? null)
    } catch { setMessages(['Could not refresh the summary. Try again.']) }
  }

  return { task, loading, saving, stale, generate, accept: (text: string) => finish(text), discard: () => finish(undefined, true), refresh,
    errors: [...messages, ...(error ? ['Could not load saved summary work. Refresh status to try again.'] : []),
      ...(liveError ? ['Live updates disconnected. Refresh status to check progress.'] : []),
      ...(task?.status === 'FAILED' && task.errorMessage && task.errorMessage !== 'Summary draft discarded.' ? [task.errorMessage] : [])] }
}
