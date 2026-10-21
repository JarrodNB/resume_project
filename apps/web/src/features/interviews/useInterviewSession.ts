/** Own the demo's GraphQL state and explicit writes. Reconnect snapshots restore durable work.
 * Rejected submissions release their identity and keep the recording. Ambiguous submissions keep
 * their exact input; a fresh owned read always precedes a manual resend.
 */
import { useEffect, useRef, useState } from 'react'
import { useApolloClient, useMutation, useQuery, useSubscription } from '@apollo/client/react'
import SparkMD5 from 'spark-md5'
import type { InterviewSnapshotFragment } from '@/graphql/generated/graphql'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { AUTHORIZE_RECORDING, BEGIN_INTERVIEW, INTERVIEW_QUERY, INTERVIEW_UPDATED, REGISTER_RECORDING, RETRY_OPERATION, START_INTERVIEW, SUBMIT_TURN } from './interviewOperations'
import { clearPendingSubmission, loadPendingSubmission, savePendingSubmission, type PendingSubmission } from './pendingSubmission'

class RejectedSubmission extends Error {}

function requirePayload<T extends { errors: string[] }>(payload: T | null | undefined): T {
  if (!payload) throw new Error('No response was received. Check saved status before trying again.')
  if (payload.errors.length) throw new Error(payload.errors.join(' '))
  return payload
}

export function useStartInterview() {
  const [mutate, { loading }] = useMutation(START_INTERVIEW)
  const [error, setError] = useState<string | null>(null)
  async function start(careerFocus = "") {
    setError(null)
    try { return requirePayload((await mutate({ variables: { careerFocus: careerFocus.trim() || null } })).data?.startInterviewDemo).interview?.id ?? null }
    catch (cause) { setError(requestErrorMessage(cause, cause instanceof Error ? cause.message : 'Could not start the interview.')); return null }
  }
  return { start, loading, error }
}

export function useInterviewSession(id: string, ownerId: string) {
  const client = useApolloClient()
  const query = useQuery(INTERVIEW_QUERY, { variables: { id }, fetchPolicy: 'network-only' })
  const subscription = useSubscription(INTERVIEW_UPDATED, {
    variables: { id },
    onData: ({ data, client }) => {
      const interviewSession = data.data?.interviewSessionUpdated
      if (interviewSession) client.cache.writeQuery({ query: INTERVIEW_QUERY, variables: { id }, data: { interviewSession } })
    },
  })
  const [authorize] = useMutation(AUTHORIZE_RECORDING)
  const [register] = useMutation(REGISTER_RECORDING)
  const [submit] = useMutation(SUBMIT_TURN)
  const [retry] = useMutation(RETRY_OPERATION)
  const [begin] = useMutation(BEGIN_INTERVIEW)
  const beginning = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingSubmission | null>(() => loadPendingSubmission(ownerId, id))
  const interview = query.data?.interviewSession ?? null
  const unresolved = pending && !interview?.operations.some((operation) => operation.submissionKey === pending.submissionKey) ? pending : null

  useEffect(() => {
    if (pending && interview?.operations.some((operation) => operation.submissionKey === pending.submissionKey)) {
      clearPendingSubmission(ownerId, id)
    }
  }, [pending, interview, ownerId, id])

  function forgetPending() { clearPendingSubmission(ownerId, id); setPending(null) }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await action(); return true }
    catch (cause) { setError(requestErrorMessage(cause, cause instanceof Error ? cause.message : 'Could not complete this request. Check saved status.')); return false }
    finally { setBusy(false) }
  }
  function update(snapshot: InterviewSnapshotFragment | null | undefined) {
    if (snapshot) client.cache.writeQuery({ query: INTERVIEW_QUERY, variables: { id }, data: { interviewSession: snapshot } })
  }
  async function send(input: PendingSubmission) {
    const payload = (await submit({ variables: { input: { interviewId: id, ...input } } })).data?.submitInterviewTurn
    if (payload?.errors.length) {
      forgetPending()
      throw new RejectedSubmission(payload.errors.join(' '))
    }
    const result = requirePayload(payload)
    update(result.interview)
    forgetPending()
  }
  /** Uploads once, persists the immutable identity, then explicitly submits. No transport retries. */
  async function answer(blob: Blob) {
    let durable = false
    const saved = await run(async () => {
      if (!interview || unresolved) throw new Error('Check saved status before recording another answer.')
      const question = interview.questions.find((item) => item.position === interview.currentQuestionPosition)
      if (!question) throw new Error('This interview has no active question.')
      if (!blob.size || blob.size > 10 * 1024 * 1024) throw new Error('Record an answer under 10 MiB.')
      const contentType = blob.type.split(';')[0].toLowerCase()
      if (!['audio/webm', 'audio/mp4'].includes(contentType)) throw new Error('This recording format is unsupported. Use a browser that records WebM or MP4 audio.')
      const digest = SparkMD5.ArrayBuffer.hash(await blob.arrayBuffer(), true)
      const checksum = btoa(digest)
      const grant = requirePayload((await authorize({ variables: { input: {
        interviewId: id, questionId: question.id, expectedRevision: interview.revision, contentType, byteSize: blob.size, checksum,
      } } })).data?.authorizeInterviewRecording).upload
      if (!grant) throw new Error('No recording upload was authorized.')
      const headers = grant.headers
      if (!headers || typeof headers !== 'object' || Array.isArray(headers) || !Object.values(headers).every((value) => typeof value === 'string')) throw new Error('The upload headers are invalid.')
      const response = await fetch(grant.uploadUrl, { method: 'PUT', headers: headers as Record<string, string>, body: blob, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(60_000) })
      if (!response.ok) throw new Error('The recording upload failed. Try submitting your recording again.')
      requirePayload((await register({ variables: { input: { interviewId: id, mediaId: grant.mediaId } } })).data?.registerInterviewRecording)
      const input = { questionId: question.id, recordingId: grant.mediaId, expectedRevision: interview.revision, submissionKey: crypto.randomUUID() }
      if (!savePendingSubmission(ownerId, id, input)) throw new Error('Browser storage is unavailable. Enable it before submitting so reloads can recover safely.')
      durable = true
      setPending(input)
      try { await send(input) }
      catch (cause) {
        if (cause instanceof RejectedSubmission) durable = false
        throw cause
      }
    })
    return saved || durable
  }
  /** A click reconciles first; auth/read errors exit without replaying a write. */
  async function checkSavedStatus(resend = false) {
    await run(async () => {
      const latest = (await query.refetch()).data?.interviewSession
      if (!latest) throw new Error('Could not confirm saved status. Try again when connected.')
      const saved = pending && latest.operations.some((operation) => operation.submissionKey === pending.submissionKey)
      if (saved) forgetPending()
      else if (resend && pending) await send(pending)
    })
  }
  /** Begin is explicitly requested and safe to repeat after a lost response. */
  async function beginInterview() {
    if (beginning.current) return
    beginning.current = true
    try {
      await run(async () => update(requirePayload((await begin({ variables: { interviewId: id } })).data?.beginInterview).interview))
    } finally { beginning.current = false }
  }
  async function retryOperation(operationId: string) {
    await run(async () => update(requirePayload((await retry({ variables: { input: { interviewId: id, operationId } } })).data?.retryInterviewOperation).interview))
  }
  return { interview, loading: query.loading, loadError: query.error, subscriptionError: subscription.error, busy, error, unresolved, answer, checkSavedStatus, retryOperation, beginInterview }
}
