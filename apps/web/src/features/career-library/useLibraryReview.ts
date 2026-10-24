/** Follows one section's review through the existing task subscription, without polling. */
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client/react'
import { useAiTaskUpdates } from '@/features/ai-tasks/useAiTaskUpdates'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { LIBRARY_REVIEW_QUERY, REVIEW_LIBRARY_SECTION_MUTATION } from './libraryReviewOperations'

export function useLibraryReview(section: string, sourceRevision: string) {
  const { data, error, loading: checkingFreshness, refetch } = useQuery(LIBRARY_REVIEW_QUERY, {
    variables: { section }, fetchPolicy: 'cache-and-network', notifyOnNetworkStatusChange: true,
  })
  const [request, { loading: starting }] = useMutation(REVIEW_LIBRARY_SECTION_MUTATION)
  const [started, setStarted] = useState<{ id: string; previousId: string | null } | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const task = data?.libraryReview.aiTask
  const localId = started && (task?.id ?? null) === started.previousId ? started.id : ''
  const followedId = localId || (task?.status === 'QUEUED' ? task.id : '')
  const { aiTask, error: subscriptionError } = useAiTaskUpdates(followedId)
  const status = aiTask && aiTask.id === followedId ? aiTask.status : followedId ? 'QUEUED' : task?.status
  const busy = starting || status === 'QUEUED'
  const refreshedTask = useRef('')
  const previousRevision = useRef(sourceRevision)
  const [checkedSource, setCheckedSource] = useState(sourceRevision)
  const requesting = useRef(false)

  useEffect(() => {
    if (previousRevision.current === sourceRevision) return
    previousRevision.current = sourceRevision
    void refetch().then(() => setCheckedSource(sourceRevision)).catch(() => setErrors(['Could not refresh the assessments. Review this section again or reload.']))
  }, [sourceRevision, refetch])

  useEffect(() => {
    if (!aiTask || aiTask.status === 'QUEUED' || refreshedTask.current === aiTask.id) return
    refreshedTask.current = aiTask.id
    void refetch().catch(() => setErrors(['Could not load the completed review. Reload to try again.']))
  }, [aiTask, refetch])

  async function start() {
    if (busy || requesting.current) return
    requesting.current = true
    setErrors([])
    try {
      const response = await request({ variables: { section } })
      const payload = response.data?.reviewLibrarySection
      setErrors(payload?.errors ?? [])
      if (payload?.aiTask) setStarted({ id: payload.aiTask.id, previousId: task?.id ?? null })
    } catch (error) {
      setErrors([requestErrorMessage(error, 'Could not start the review. Please try again.')])
    } finally {
      requesting.current = false
    }
  }

  const errorMessage = aiTask && aiTask.id === followedId ? aiTask.errorMessage : task?.errorMessage
  const uncertain = !!error || checkingFreshness || checkedSource !== sourceRevision
  return {
    assessments: (data?.libraryReview.assessments ?? []).map((item) => uncertain ? { ...item, stale: true } : item),
    start, busy,
    errors: [...errors, ...(error ? ['Could not load the assessments. Reload to try again.'] : []),
      ...(status === 'FAILED' && errorMessage ? [errorMessage] : []),
      ...(subscriptionError ? ['Live updates disconnected. Reload to check the review.'] : [])],
  }
}
