/** Loads one target's saved editing turn and follows its task through the existing subscription. */
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client/react'
import { useAiTaskUpdates } from '@/features/ai-tasks/useAiTaskUpdates'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import type { LibraryEditQuery } from '@/graphql/generated/graphql'
import { CAREER_LIBRARY_QUERY } from './careerLibraryOperations'
import { ACCEPT_LIBRARY_EDIT_MUTATION, DISCARD_LIBRARY_EDIT_MUTATION, LIBRARY_EDIT_QUERY, START_LIBRARY_EDIT_MUTATION } from './libraryEditOperations'
import { LIBRARY_REVIEW_QUERY } from './libraryReviewOperations'

type EditTask = NonNullable<LibraryEditQuery['libraryEdit']['aiTask']>

export function useLibraryEdit(kind: string, recordId: string, sourceRevision: string) {
  const { data, error, loading, refetch } = useQuery(LIBRARY_EDIT_QUERY, { variables: { kind, recordId }, fetchPolicy: 'network-only' })
  const [submitted, setSubmitted] = useState<EditTask | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [request, requestState] = useMutation(START_LIBRARY_EDIT_MUTATION)
  const [accept, acceptState] = useMutation(ACCEPT_LIBRARY_EDIT_MUTATION)
  const [discard, discardState] = useMutation(DISCARD_LIBRARY_EDIT_MUTATION)
  const saved = data?.libraryEdit.aiTask
  const base = submitted ?? saved
  const { aiTask: updated, error: subscriptionError } = useAiTaskUpdates(base?.id ?? '')
  // Subscription values are event snapshots, so a prior completion event must not
  // hide the explicit acceptance response for the same task.
  const task = submitted?.acceptedAt ? submitted : updated?.id === base?.id ? updated : base
  const busy = loading || requestState.loading || acceptState.loading || discardState.loading || task?.status === 'QUEUED'
  const pending = useRef(false)
  const lastSource = useRef(sourceRevision)
  const [checkedSource, setCheckedSource] = useState(sourceRevision)

  useEffect(() => {
    if (lastSource.current === sourceRevision) return
    lastSource.current = sourceRevision
    let current = true
    void refetch().then(() => { if (current) setCheckedSource(sourceRevision) }).catch(() => setErrors(['Could not refresh this edit. Reload to continue.']))
    return () => { current = false }
  }, [sourceRevision, refetch])

  const stale = checkedSource !== sourceRevision || (!!data?.libraryEdit.stale && (!submitted || submitted.id === saved?.id))

  async function submit(feedback: string, skip = false, fresh = false) {
    if (busy || pending.current) return false
    pending.current = true
    setErrors([])
    try {
      const result = await request({ variables: {
        kind, recordId, feedback, skip,
        previousTaskId: !fresh && !stale && task && !task.acceptedAt ? task.id : null,
      } })
      const payload = result.data?.startLibraryEdit
      setErrors(payload?.errors ?? ['Could not start this edit.'])
      if (payload?.aiTask) {
        setSubmitted(payload.aiTask)
        setCheckedSource(sourceRevision)
      }
      return !!payload?.aiTask && payload.errors.length === 0
    } catch (failure) {
      setErrors([requestErrorMessage(failure, 'Could not start this edit. Please try again.')])
      return false
    } finally { pending.current = false }
  }

  async function save() {
    if (!task || pending.current || busy || stale) return
    pending.current = true
    setErrors([])
    try {
      const result = await accept({ variables: { aiTaskId: task.id },
        refetchQueries: [CAREER_LIBRARY_QUERY, LIBRARY_REVIEW_QUERY], awaitRefetchQueries: true })
      const payload = result.data?.acceptLibraryEdit
      setErrors(payload?.errors ?? ['Could not save this draft.'])
      if (payload?.aiTask && payload.errors.length === 0) setSubmitted(payload.aiTask)
    } catch (failure) {
      setErrors([requestErrorMessage(failure, 'Could not save this draft. Please try again.')])
    } finally { pending.current = false }
  }

  async function closeDraft() {
    if (!task) return true
    if (pending.current) return false
    pending.current = true
    setErrors([])
    try {
      const result = await discard({ variables: { aiTaskId: task.id } })
      const messages = result.data?.discardLibraryEdit?.errors ?? ['Could not discard this draft.']
      setErrors(messages)
      return messages.length === 0
    } catch (failure) {
      setErrors([requestErrorMessage(failure, 'Could not discard this draft. Please try again.')])
      return false
    } finally { pending.current = false }
  }

  return { task, busy, loading, stale, submit, save, closeDraft,
    errors: [...errors, ...(error && !submitted ? ['Could not load this edit. Close and reopen to try again.'] : []),
      ...(subscriptionError ? ['Live updates disconnected. Close and reopen to check the edit.'] : []),
      ...(task?.status === 'FAILED' && task.errorMessage ? [task.errorMessage] : [])] }
}
