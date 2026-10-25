/** Owns queued guide generation and live updates; saved successful material survives failed attempts. */
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client/react'
import { useAiTaskUpdates } from '@/features/ai-tasks/useAiTaskUpdates'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { GENERATE_STUDY_GUIDE_MUTATION, STUDY_GUIDE_QUERY } from './studyGuideOperations'

export function useStudyGuide(jobId: string) {
  const query = useQuery(STUDY_GUIDE_QUERY, { variables: { jobId } })
  const [mutate, { loading: starting }] = useMutation(GENERATE_STUDY_GUIDE_MUTATION)
  const [errors, setErrors] = useState<string[]>([])
  const requesting = useRef(false)
  const refreshed = useRef('')
  const latest = query.data?.job?.latestStudyGuideTask ?? null
  const active = latest && latest.status !== 'COMPLETED' && latest.status !== 'FAILED'
  const { aiTask, error: subscriptionError } = useAiTaskUpdates(active ? latest.id : '')
  const task = aiTask?.id === latest?.id ? aiTask : latest
  const busy = starting || Boolean(task && task.status !== 'COMPLETED' && task.status !== 'FAILED')
  const { refetch } = query

  useEffect(() => {
    if (latest?.status === 'COMPLETED' && latest.id !== query.data?.job?.latestStudyGuide?.id && latest.id !== refreshed.current) {
      refreshed.current = latest.id
      void refetch().catch(() => setErrors(["Couldn't refresh the saved guide. Reload to try again."]))
    }
  }, [latest, query.data?.job?.latestStudyGuide?.id, refetch])

  async function start() {
    if (requesting.current || busy) return
    requesting.current = true
    setErrors([])
    try {
      const response = await mutate({ variables: { jobId }, update(cache, { data }) {
        const payload = data?.generateStudyGuide
        if (!payload?.aiTask || payload.errors.length) return
        cache.updateQuery({ query: STUDY_GUIDE_QUERY, variables: { jobId } }, (existing) => existing?.job
          ? { job: { ...existing.job, latestStudyGuideTask: payload.aiTask } } : existing)
      } })
      const payload = response.data?.generateStudyGuide
      if (!payload?.aiTask || payload.errors.length) setErrors(payload?.errors.length ? payload.errors : ["Couldn't start the study guide. Try again."])
    } catch (error) {
      setErrors([requestErrorMessage(error, "Couldn't reach the server. Try again.")])
    } finally { requesting.current = false }
  }

  return { guideTask: query.data?.job?.latestStudyGuide ?? null, task, busy, starting, start,
    loading: query.loading, loadError: query.error, errors, subscriptionError }
}
