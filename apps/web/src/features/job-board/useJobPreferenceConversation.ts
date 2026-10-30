/** Follow queued preference turns and recover accepted dialogue on reopen.
 * Keep edits locked until both accepted dialogue and its profile finish refreshing,
 * so a later saved draft cannot replace newly typed text. Failed recovery is reloadable.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client/react'
import { useAiTaskUpdates } from '@/features/ai-tasks/useAiTaskUpdates'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import type { JobPreferenceConversationQuery } from '@/graphql/generated/graphql'
import { JOB_PREFERENCE_CONVERSATION, START_JOB_PREFERENCE_CONVERSATION } from './jobPreferenceOperations'

type Task = NonNullable<JobPreferenceConversationQuery['jobPreferenceConversation']['aiTask']>

function versionOf(value: unknown) {
  if (!value || typeof value !== 'object' || !('profile_version' in value)) return null
  return typeof value.profile_version === 'number' ? value.profile_version : null
}

export function useJobPreferenceConversation(version: number, onAccepted: () => Promise<void>) {
  const query = useQuery(JOB_PREFERENCE_CONVERSATION, { fetchPolicy: 'network-only' })
  const [request, requestState] = useMutation(START_JOB_PREFERENCE_CONVERSATION)
  const [submitted, setSubmitted] = useState<Task | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [recovering, setRecovering] = useState(0)
  const pending = useRef(false)
  const recoveryStarted = useRef(new Set<string>())
  const [recovered, setRecovered] = useState(new Set<string>())
  const state = query.data?.jobPreferenceConversation
  const base = submitted ?? state?.aiTask
  const { aiTask: update, error: subscriptionError } = useAiTaskUpdates(base?.id ?? '')
  const task = update?.id === base?.id ? update : base
  const expectedVersion = versionOf(task?.result) ?? versionOf(task?.input)
  const stale = (state?.aiTask?.id === task?.id && state?.stale === true) ||
    (typeof expectedVersion === 'number' && expectedVersion !== version)
  const refetch = query.refetch
  const needsRecovery = Boolean(task && task.status !== 'QUEUED' && !recovered.has(task.id)
    && (submitted?.id === task.id || update?.id === task.id
      || (state?.aiTask?.id === task.id && !state.stale && typeof expectedVersion === 'number' && expectedVersion !== version)))
  const busy = query.loading || requestState.loading || recovering > 0 || needsRecovery || (task?.status === 'QUEUED' && !stale)

  const recover = useCallback(async (taskId: string | undefined, message: string) => {
    setRecovering((count) => count + 1)
    try {
      // Wait for both reads even if one fails, so no remaining profile read can
      // remount the editor after the recovery lock has been released.
      const results = await Promise.allSettled([Promise.resolve().then(() => refetch()), Promise.resolve().then(onAccepted)])
      if (results.some((result) => result.status === 'rejected')) { setErrors([message]); return }
      // A late recovery must never discard a different submitted turn.
      setSubmitted((current) => current?.id === taskId ? null : current)
    } finally {
      if (taskId) setRecovered((current) => new Set(current).add(taskId))
      setRecovering((count) => count - 1)
    }
  }, [refetch, onAccepted])

  useEffect(() => {
    if (!task || !needsRecovery || recoveryStarted.current.has(task.id)) return
    recoveryStarted.current.add(task.id)
    void Promise.resolve().then(() => recover(task.id, 'Could not refresh the saved conversation. Reload to recover it.'))
  }, [task, needsRecovery, recover])

  async function send(message: string, fresh = false) {
    if (pending.current || busy) return false
    pending.current = true
    setErrors([])
    try {
      const result = await request({ variables: { message: message.trim(), expectedVersion: version,
        previousTaskId: !fresh && !stale ? task?.id ?? null : null } })
      const payload = result.data?.startJobPreferenceConversation
      if (!payload?.aiTask || payload.errors.length) {
        setErrors(payload?.errors.length ? payload.errors : ['Could not start the conversation. Please try again.'])
        return false
      }
      setSubmitted(payload.aiTask)
      return true
    } catch (error) {
      setErrors([requestErrorMessage(error, 'Could not send your preferences. Please try again.')])
      return false
    } finally { pending.current = false }
  }

  async function reload() {
    setErrors([])
    await recover(task?.id, 'Could not refresh the saved conversation. Please try again.')
  }

  return { task, turns: state?.turns ?? [], stale, busy, loading: query.loading, send, reload,
    errors: [...errors, ...(query.error ? ['Could not load the conversation. Please reload.'] : []),
      ...(subscriptionError ? ['Live updates disconnected. Reload the conversation to recover its saved result.'] : []),
      ...(task?.status === 'FAILED' && task.errorMessage ? [task.errorMessage] : [])] }
}
