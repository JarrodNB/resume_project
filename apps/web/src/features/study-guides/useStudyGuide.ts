/** Reads one ordered job collection in bounded batches and follows generation without moving the reader. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApolloClient, useMutation, useQuery } from '@apollo/client/react'
import { useAiTaskUpdates } from '@/features/ai-tasks/useAiTaskUpdates'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import type { StudyQuestionCollectionQuery } from '@/graphql/generated/graphql'
import { GENERATE_STUDY_GUIDE_MUTATION, STUDY_QUESTION_COLLECTION_QUERY } from './studyGuideOperations'
import { parseStudyGuide } from './parseStudyGuide'

type Batch = StudyQuestionCollectionQuery['job']['studyQuestionBatches']['batches'][number]

/** Key the caller by job identity so neither saved questions nor in-flight state cross jobs. */
export function useStudyGuide(jobId: string, description: string | null) {
  const client = useApolloClient()
  const query = useQuery(STUDY_QUESTION_COLLECTION_QUERY, { variables: { jobId, cursor: null }, fetchPolicy: 'cache-and-network' })
  const [mutate, { loading: starting }] = useMutation(GENERATE_STUDY_GUIDE_MUTATION)
  const [errors, setErrors] = useState<string[]>([])
  const [laterBatches, setLaterBatches] = useState<Batch[]>([])
  const [tailCursor, setTailCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [retryReadyId, setRetryReadyId] = useState<string | null>(null)
  const [additionalTotal, setAdditionalTotal] = useState(0)
  const requesting = useRef(false)
  const requestingPage = useRef(false)
  const mounted = useRef(true)
  const refreshed = useRef('')
  const followed = useRef('')
  const previousDescription = useRef(description)
  const refreshRevision = useRef(0)
  const refreshInFlight = useRef<Promise<void> | null>(null)
  const first = query.data?.job.studyQuestionBatches
  const fingerprint = query.data?.job.studyGuideDescriptionFingerprint
  const latest = query.data?.job.latestStudyGuideTask ?? null
  const active = latest && latest.status !== 'COMPLETED' && latest.status !== 'FAILED'
  const { aiTask, error: subscriptionError } = useAiTaskUpdates(active ? latest.id : '')
  const task = aiTask?.id === latest?.id ? aiTask : latest
  const retryAfterSeconds = latest?.studyGuideRetryAfterSeconds
  const retryReady = task?.status === 'QUEUED' && (retryAfterSeconds === 0 || task.id === retryReadyId)
  const busy = starting || Boolean(task && task.status !== 'COMPLETED' && task.status !== 'FAILED' && !retryReady)
  const totalQuestions = Math.max(first?.totalQuestions ?? 0, additionalTotal)
  const questions = useMemo(() => {
    const seen = new Set<string>()
    return [...(first?.batches ?? []), ...laterBatches].filter((batch) => {
      if (seen.has(batch.id)) return false
      seen.add(batch.id); return true
    }).flatMap((batch) => (parseStudyGuide(batch.result)?.questions ?? []).map((question) => ({
      ...question,
      outOfDate: fingerprint ? batch.sourceDescriptionFingerprint !== fingerprint : batch.outOfDate,
    })))
  }, [first, laterBatches, fingerprint])
  const { refetch } = query

  // Queue a final read when Apollo deduplicates a description edit or completion with an in-flight read.
  const refresh = useCallback(() => {
    refreshRevision.current += 1
    if (refreshInFlight.current) return refreshInFlight.current
    async function readLatest() {
      let revision: number
      let failure: unknown
      do {
        revision = refreshRevision.current
        try { await refetch(); failure = undefined } catch (error) { failure = error }
      } while (mounted.current && revision !== refreshRevision.current)
      if (failure) throw failure
    }
    const pending = readLatest().finally(() => { refreshInFlight.current = null })
    refreshInFlight.current = pending
    return pending
  }, [refetch])

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (latest?.status !== 'QUEUED' || retryAfterSeconds == null || retryAfterSeconds <= 0) return
    const timer = setTimeout(() => setRetryReadyId(latest.id), Math.ceil(retryAfterSeconds * 1000))
    return () => clearTimeout(timer)
  }, [latest?.id, latest?.status, retryAfterSeconds])
  useEffect(() => {
    if (previousDescription.current === description) return
    previousDescription.current = description
    setPageError(null)
    void refresh().catch(() => { if (mounted.current) setPageError("Couldn't refresh question freshness. Reload to try again.") })
  }, [description, refresh])
  useEffect(() => { if (active && latest) followed.current = latest.id }, [active, latest])
  useEffect(() => {
    if (task?.status !== 'COMPLETED' || task.id !== followed.current || task.id === refreshed.current) return
    refreshed.current = task.id
    void refresh().catch(() => { if (mounted.current) setPageError("Couldn't refresh saved questions. Reload to try again.") })
  }, [task, refresh])

  async function loadMore() {
    const cursor = tailCursor ?? first?.endCursor
    if (!cursor || requestingPage.current) return false
    requestingPage.current = true; setLoadingMore(true); setPageError(null)
    try {
      const response = await client.query({ query: STUDY_QUESTION_COLLECTION_QUERY, variables: { jobId, cursor }, fetchPolicy: 'no-cache' })
      if (!mounted.current) return false
      const page = response.data?.job.studyQuestionBatches
      if (!page || page.errors.length || !page.batches.length) {
        setPageError(page?.errors.join(' ') || "Couldn't load more questions. Try Next again."); return false
      }
      setLaterBatches((existing) => [...existing, ...page.batches.filter((batch) => !existing.some((saved) => saved.id === batch.id))])
      setTailCursor(page.endCursor); setAdditionalTotal(page.totalQuestions)
      return true
    } catch {
      if (mounted.current) setPageError("Couldn't load more questions. Try Next again.")
      return false
    } finally {
      requestingPage.current = false
      if (mounted.current) setLoadingMore(false)
    }
  }

  async function start() {
    if (requesting.current || busy) return
    requesting.current = true; setErrors([])
    try {
      const response = await mutate({ variables: { jobId }, update(cache, { data }) {
        const payload = data?.generateStudyGuide
        if (!payload?.aiTask || payload.errors.length) return
        cache.updateQuery({ query: STUDY_QUESTION_COLLECTION_QUERY, variables: { jobId, cursor: null } }, (existing) => existing?.job
          ? { job: { ...existing.job, latestStudyGuideTask: payload.aiTask } } : existing)
      } })
      const payload = response.data?.generateStudyGuide
      if (mounted.current && (!payload?.aiTask || payload.errors.length)) setErrors(payload?.errors.length ? payload.errors : ["Couldn't start study questions. Try again."])
    } catch (error) {
      if (mounted.current) setErrors([requestErrorMessage(error, "Couldn't reach the server. Try again.")])
    } finally { requesting.current = false }
  }

  return { questions, totalQuestions, task, busy, retryReady, starting, start, loadMore, loadingMore,
    pageError: pageError ?? first?.errors.join(' '), loading: query.loading, loadError: query.error, errors, subscriptionError }
}
