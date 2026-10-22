/** Own the demo's GraphQL state and explicit writes. Reconnect snapshots restore durable work.
 * Rejected submissions release their identity and keep the recording. Ambiguous submissions keep
 * their exact input; a fresh owned read always precedes a manual resend.
 */
import { useEffect, useRef, useState } from 'react'
import { useApolloClient, useMutation, useQuery, useSubscription } from '@apollo/client/react'
import SparkMD5 from 'spark-md5'
import type { InterviewSetupInput, InterviewSnapshotFragment } from '@/graphql/generated/graphql'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { ABANDON_INTERVIEW, AUTHORIZE_RECORDING, BEGIN_INTERVIEW, INTERVIEW_QUERY, INTERVIEW_UPDATED, REGISTER_RECORDING, RETRY_OPERATION, START_INTERVIEW, SUBMIT_TURN, START_RECORDED_TRANSCRIPTION, CANCEL_RECORDED_TRANSCRIPTION } from './interviewOperations'
import type { TranscriptionMode } from './transcriptionCapture'
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
  async function start(careerFocus = "", setup: InterviewSetupInput = { questionCount: 8 }) {
    setError(null)
    try { return requirePayload((await mutate({ variables: { careerFocus: careerFocus.trim() || null, setup } })).data?.startInterviewDemo).interview?.id ?? null }
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
  const [startTranscription] = useMutation(START_RECORDED_TRANSCRIPTION)
  const [cancelRecorded] = useMutation(CANCEL_RECORDED_TRANSCRIPTION)
  const captureUpload = useRef<{ blob: Blob; revision: number; mediaId: string } | null>(null)
  const [register] = useMutation(REGISTER_RECORDING)
  const [submit] = useMutation(SUBMIT_TURN)
  const [retry] = useMutation(RETRY_OPERATION)
  const [begin] = useMutation(BEGIN_INTERVIEW)
  const [abandon] = useMutation(ABANDON_INTERVIEW)
  const beginning = useRef(false)
  const submittingText = useRef(false)
  const retainedText = useRef<{ submissionKey: string; text: string } | null>(null)
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

  function forgetPending() { clearPendingSubmission(ownerId, id); setPending(null); retainedText.current = null }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await action(); return true }
    catch (cause) { setError(requestErrorMessage(cause, cause instanceof Error ? cause.message : 'Could not complete this request. Check saved status.')); return false }
    finally { setBusy(false) }
  }
  function update(snapshot: InterviewSnapshotFragment | null | undefined) {
    const current = client.cache.readQuery({ query: INTERVIEW_QUERY, variables: { id } })?.interviewSession
    if (snapshot && (!current || snapshot.revision >= current.revision)) client.cache.writeQuery({ query: INTERVIEW_QUERY, variables: { id }, data: { interviewSession: snapshot } })
  }
  async function send(input: PendingSubmission, candidateTranscript?: string) {
    const payload = (await submit({ variables: { input: { interviewId: id, ...input, ...(candidateTranscript ? { candidateTranscript } : {}) } } })).data?.submitInterviewTurn
    if (payload?.errors.length) {
      forgetPending()
      throw new RejectedSubmission(payload.errors.join(' '))
    }
    const result = requirePayload(payload)
    update(result.interview)
    forgetPending()
  }
  /** Seal complete audio once so a lost capture receipt can be retried without reupload. */
  async function uploadRecording(blob: Blob, snapshot: InterviewSnapshotFragment) {
    const question = snapshot.questions.find((item) => item.position === snapshot.currentQuestionPosition)
    if (!question) throw new Error('This interview has no active question.')
    if (!blob.size || blob.size > 10 * 1024 * 1024) throw new Error('Record an answer under 10 MiB.')
    const contentType = blob.type.split(';')[0].toLowerCase()
    if (!['audio/webm', 'audio/mp4'].includes(contentType)) throw new Error('This recording format is unsupported. Use a browser that records WebM or MP4 audio.')
    const digest = SparkMD5.ArrayBuffer.hash(await blob.arrayBuffer(), true)
    const checksum = btoa(digest)
    const grant = requirePayload((await authorize({ variables: { input: {
      interviewId: id, questionId: question.id, expectedRevision: snapshot.revision, contentType, byteSize: blob.size, checksum,
    } } })).data?.authorizeInterviewRecording).upload
    if (!grant) throw new Error('No recording upload was authorized.')
    const headers = grant.headers
    if (!headers || typeof headers !== 'object' || Array.isArray(headers) || !Object.values(headers).every((value) => typeof value === 'string')) throw new Error('The upload headers are invalid.')
    const response = await fetch(grant.uploadUrl, { method: 'PUT', headers: headers as Record<string, string>, body: blob, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new Error('The recording upload failed. Try transcribing your recording again.')
    requirePayload((await register({ variables: { input: { interviewId: id, mediaId: grant.mediaId } } })).data?.registerInterviewRecording)
    return grant.mediaId
  }
  async function transcribeRecording(blob: Blob) {
    let operationId: string | null = null
    await run(async () => {
      if (!interview || unresolved) throw new Error('Check saved status before transcribing.')
      const question = interview.questions.find((item) => item.position === interview.currentQuestionPosition)
      if (!question) throw new Error('This interview has no active question.')
      if (captureUpload.current?.blob !== blob || captureUpload.current.revision !== interview.revision) {
        captureUpload.current = { blob, revision: interview.revision, mediaId: await uploadRecording(blob, interview) }
      }
      const mediaId = captureUpload.current.mediaId
      const result = requirePayload((await startTranscription({ variables: { input: {
        interviewId: id, questionId: question.id, expectedRevision: interview.revision, recordingId: mediaId,
      } } })).data?.startRecordedTranscription)
      update(result.interview)
      operationId = result.operationId ?? null
    })
    return operationId
  }
  async function cancelTranscription(operationId: string) {
    return run(async () => update(requirePayload((await cancelRecorded({ variables: { input: { interviewId: id, operationId } } })).data?.cancelRecordedTranscription).interview))
  }
  /** Uploads once, persists the immutable identity, then explicitly submits. No transport retries. */
  async function answer(blob: Blob, candidateTranscript?: string | null, transcriptionMode: TranscriptionMode = 'recorded') {
    let durable = false
    const saved = await run(async () => {
      if (!interview || unresolved) throw new Error('Check saved status before recording another answer.')
      const question = interview.questions.find((item) => item.position === interview.currentQuestionPosition)
      if (!question) throw new Error('This interview has no active question.')
      const mediaId = await uploadRecording(blob, interview)
      const transcriptDigest = candidateTranscript ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(candidateTranscript))), (byte) => byte.toString(16).padStart(2, '0')).join('') : undefined
      const input = { ...(transcriptDigest ? { transcriptDigest, transcriptionMode } : {}), questionId: question.id, recordingId: mediaId, expectedRevision: interview.revision, submissionKey: crypto.randomUUID() }
      if (!savePendingSubmission(ownerId, id, input)) throw new Error('Browser storage is unavailable. Enable it before submitting so reloads can recover safely.')
      durable = true
      setPending(input)
      try { await send(input, candidateTranscript ?? undefined) }
      catch (cause) {
        if (cause instanceof RejectedSubmission) durable = false
        throw cause
      }
    })
    return saved || durable
  }
  /** Reviewed text stays in memory; only its immutable digest/identity survives a reload. */
  async function answerText(text: string) {
    if (submittingText.current) return false
    submittingText.current = true
    try {
      return await run(async () => {
        if (!interview || unresolved) throw new Error('Check saved status before submitting another answer.')
        if (!text.trim() || text.length > 4_000) throw new Error('Enter an answer between 1 and 4,000 characters.')
        const question = interview.questions.find((item) => item.position === interview.currentQuestionPosition)
        if (!question) throw new Error('This interview has no active question.')
        const transcriptDigest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), (byte) => byte.toString(16).padStart(2, '0')).join('')
        const input: PendingSubmission = { questionId: question.id, expectedRevision: interview.revision, submissionKey: crypto.randomUUID(), transcriptionMode: 'typed', transcriptDigest }
        if (!savePendingSubmission(ownerId, id, input)) throw new Error('Browser storage is unavailable. Enable it before submitting so reloads can recover safely.')
        retainedText.current = { submissionKey: input.submissionKey, text }
        setPending(input)
        await send(input, text)
      })
    } finally { submittingText.current = false }
  }
  /** A click reconciles first; auth/read errors exit without replaying a write. */
  async function checkSavedStatus(resend = false) {
    await run(async () => {
      const latest = (await query.refetch()).data?.interviewSession
      if (!latest) throw new Error('Could not confirm saved status. Try again when connected.')
      const saved = pending && latest.operations.some((operation) => operation.submissionKey === pending.submissionKey)
      if (saved) forgetPending()
      else if (pending?.transcriptionMode === 'typed' && !retainedText.current) {
        forgetPending()
        throw new Error('This answer was not saved. Unsent text is not retained after reload; type your answer again.')
      } else if (resend && pending) {
        if (pending.transcriptionMode === 'typed') {
          const retained = retainedText.current
          if (!retained || retained.submissionKey !== pending.submissionKey) throw new Error('Your reviewed text is unavailable. Check saved status again.')
          await send(pending, retained.text)
          return
        }
        // Text stays out of browser storage. An owned fresh read confirmed the old
        // identity absent; explicitly retry its retained recording as a new batch turn.
        if (pending.transcriptDigest) {
          const fallback = { questionId: pending.questionId, recordingId: pending.recordingId, expectedRevision: pending.expectedRevision, submissionKey: crypto.randomUUID() }
          if (!savePendingSubmission(ownerId, id, fallback)) throw new Error('Browser storage is unavailable.')
          setPending(fallback)
          await send(fallback)
        } else await send(pending)
      }
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
  /** Clear ambiguous submission recovery only after the owner confirms a saved abandonment. */
  async function abandonInterview() {
    return run(async () => {
      const snapshot = requirePayload((await abandon({ variables: { interviewId: id } })).data?.abandonInterview).interview
      if (!snapshot || snapshot.status !== 'abandoned') throw new Error('Could not confirm abandonment. Check saved status before trying again.')
      update(snapshot)
      forgetPending()
    })
  }
  return { interview, loading: query.loading, loadError: query.error, subscriptionError: subscription.error, busy, error, unresolved, answer, answerText, transcribeRecording, cancelTranscription, checkSavedStatus, retryOperation, beginInterview, abandonInterview }
}
