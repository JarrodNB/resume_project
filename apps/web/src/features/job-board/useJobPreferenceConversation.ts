/** Follow the owner's queued preference turns and recover accepted dialogue on reopen. */
import { useEffect, useRef, useState } from 'react'
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
  const pending = useRef(false)
  const recovered = useRef(new Set<string>())
  const state = query.data?.jobPreferenceConversation
  const base = submitted ?? state?.aiTask
  const { aiTask: update, error: subscriptionError } = useAiTaskUpdates(base?.id ?? '')
  const task = update?.id === base?.id ? update : base
  const expectedVersion = versionOf(task?.result) ?? versionOf(task?.input)
  const stale = (state?.aiTask?.id === task?.id && state?.stale === true) ||
    (typeof expectedVersion === 'number' && expectedVersion !== version)
  const busy = requestState.loading || (task?.status === 'QUEUED' && !stale)
  const refetch = query.refetch

  useEffect(() => {
    if (!task || task.status === 'QUEUED' || recovered.current.has(task.id)) return
    if (submitted?.id !== task.id && update?.id !== task.id) return
    // Reopened tasks arrive through the subscription without local submission state.
    // A task recovers once; late recovery must not discard a newer submitted turn.
    const taskId = task.id
    recovered.current.add(taskId)
    void Promise.all([refetch(), onAccepted()]).then(() => {
      setSubmitted((current) => current?.id === taskId ? null : current)
    }).catch(() => { setErrors(['Could not refresh the saved conversation. Reload to recover it.']) })
  }, [task, submitted, update, refetch, onAccepted])

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
    const taskId = task?.id
    setErrors([])
    try {
      await Promise.all([refetch(), onAccepted()])
      setSubmitted((current) => current?.id === taskId ? null : current)
    } catch { setErrors(['Could not refresh the saved conversation. Please try again.']) }
  }

  return { task, turns: state?.turns ?? [], stale, busy, loading: query.loading, send, reload,
    errors: [...errors, ...(query.error ? ['Could not load the conversation. Please reload.'] : []),
      ...(subscriptionError ? ['Live updates disconnected. Reload the conversation to recover its saved result.'] : []),
      ...(task?.status === 'FAILED' && task.errorMessage ? [task.errorMessage] : [])] }
}
