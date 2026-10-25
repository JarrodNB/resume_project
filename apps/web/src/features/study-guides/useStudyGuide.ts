/** Owns paginated guide history, selected content, and live generation without discarding saved material. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApolloClient, useMutation, useQuery } from '@apollo/client/react'
import { useAiTaskUpdates } from '@/features/ai-tasks/useAiTaskUpdates'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import type { StudyGuideForJobQuery } from '@/graphql/generated/graphql'
import { GENERATE_STUDY_GUIDE_MUTATION, STUDY_GUIDE_QUERY, STUDY_GUIDE_CONTENT_QUERY } from './studyGuideOperations'

type Summary = StudyGuideForJobQuery['job']['studyGuides']['guides'][number]
const unique = (guides: Summary[]) => [...new Map(guides.map((guide) => [guide.id, guide])).values()]

/** The caller keys this hook's content by job identity so no selection or request state crosses jobs. */
export function useStudyGuide(jobId: string) {
  const client = useApolloClient()
  const query = useQuery(STUDY_GUIDE_QUERY, { variables: { jobId, cursor: null } })
  const [mutate, { loading: starting }] = useMutation(GENERATE_STUDY_GUIDE_MUTATION)
  const [errors, setErrors] = useState<string[]>([])
  const [retainedGuides, setRetainedGuides] = useState<Summary[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined)
  const [loadingMore, setLoadingMore] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const requesting = useRef(false)
  const requestingPage = useRef(false)
  const mounted = useRef(true)
  const refreshed = useRef('')
  const firstPage = query.data?.job?.studyGuides
  const history = useMemo(() => unique([...(firstPage?.guides ?? []), ...retainedGuides]), [firstPage, retainedGuides])
  const nextCursor = olderCursor === undefined ? firstPage?.nextCursor ?? null : olderCursor
  const latest = query.data?.job?.latestStudyGuideTask ?? null
  const active = latest && latest.status !== 'COMPLETED' && latest.status !== 'FAILED'
  const { aiTask, error: subscriptionError } = useAiTaskUpdates(active ? latest.id : '')
  const task = aiTask?.id === latest?.id ? aiTask : latest
  const busy = starting || Boolean(task && task.status !== 'COMPLETED' && task.status !== 'FAILED')
  const selectedId = selected ?? history[0]?.id ?? null
  const content = useQuery(STUDY_GUIDE_CONTENT_QUERY, { variables: { jobId, guideId: selectedId ?? '' }, skip: !selectedId })
  const { refetch } = query

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  useEffect(() => {
    if (task?.status === 'COMPLETED' && !query.data?.job?.studyGuides.guides.some((guide) => guide.id === task.id) && !history.some((guide) => guide.id === task.id) && task.id !== refreshed.current) {
      refreshed.current = task.id
      const previousGuides = firstPage?.guides ?? []
      void refetch().then(() => {
        if (mounted.current) setRetainedGuides((existing) => unique([...previousGuides, ...existing]))
      }).catch(() => { if (mounted.current) setHistoryError("Couldn't refresh saved guides. Reload to try again.") })
    }
  }, [task, history, firstPage, query.data, refetch])

  async function loadMore() {
    if (!nextCursor || requestingPage.current) return
    requestingPage.current = true
    setLoadingMore(true)
    setHistoryError(null)
    try {
      const response = await client.query({ query: STUDY_GUIDE_QUERY, variables: { jobId, cursor: nextCursor }, fetchPolicy: 'no-cache' })
      if (!mounted.current) return
      const page = response.data?.job?.studyGuides
      if (!page || page.errors.length) { setHistoryError(page?.errors.join(' ') || "Couldn't load older guides. Try again."); return }
      setRetainedGuides((existing) => unique([...(firstPage?.guides ?? []), ...existing, ...page.guides]))
      setOlderCursor(page.nextCursor ?? null)
    } catch (error) {
      if (mounted.current) setHistoryError(requestErrorMessage(error, "Couldn't load older guides. Try again."))
    } finally {
      requestingPage.current = false
      if (mounted.current) setLoadingMore(false)
    }
  }

  async function start() {
    if (requesting.current || busy) return
    requesting.current = true
    setErrors([])
    setRetainedGuides((existing) => unique([...(firstPage?.guides ?? []), ...existing]))
    try {
      const response = await mutate({ variables: { jobId }, update(cache, { data }) {
        const payload = data?.generateStudyGuide
        if (!payload?.aiTask || payload.errors.length) return
        cache.updateQuery({ query: STUDY_GUIDE_QUERY, variables: { jobId, cursor: null } }, (existing) => existing?.job
          ? { job: { ...existing.job, latestStudyGuideTask: payload.aiTask } } : existing)
      } })
      const payload = response.data?.generateStudyGuide
      if (mounted.current && (!payload?.aiTask || payload.errors.length)) setErrors(payload?.errors.length ? payload.errors : ["Couldn't start the study guide. Try again."])
    } catch (error) {
      if (mounted.current) setErrors([requestErrorMessage(error, "Couldn't reach the server. Try again.")])
    } finally { requesting.current = false }
  }

  const guideTask = content.data?.job?.studyGuide
  return { guideTask: guideTask?.id === selectedId ? guideTask : null, task, busy, starting, start,
    history, selectedId, select: setSelected, nextCursor, loadMore, loadingMore, historyError: historyError ?? firstPage?.errors.join(' '),
    contentLoading: content.loading, contentError: content.error, retryContent: content.refetch,
    loading: query.loading, loadError: query.error, errors, subscriptionError }
}
