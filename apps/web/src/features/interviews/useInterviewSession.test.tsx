/** Reload and network recovery use a canonical owned read before any explicit resend. */
import { act, renderHook, waitFor } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing/react'
import type { MockLink } from '@apollo/client/testing'
import { GraphQLError } from 'graphql'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useInterviewSession, useStartInterview } from './useInterviewSession'
import { loadPendingSubmission, savePendingSubmission } from './pendingSubmission'
import { ABANDON_INTERVIEW, AUTHORIZE_RECORDING, BEGIN_INTERVIEW, INTERVIEW_QUERY, INTERVIEW_UPDATED, REGISTER_RECORDING, SUBMIT_TURN, START_RECORDED_TRANSCRIPTION, START_INTERVIEW, SKIP_QUESTION } from './interviewOperations'
const snapshot = {
  setup: { __typename: 'InterviewSetup' as const, questionCount: 9, questionFormat: 'mixed', difficulty: 'realistic', interviewer: 'daniel', focusAreas: [] },
  __typename: 'InterviewSession' as const, id: 'session', status: 'active', interviewType: 'basic', executionMode: 'fake', speechPlaybackMode: 'provider', referencesEnabled: false, preparedRole: {}, revision: 0, answerCap: 2, currentQuestionPosition: 0, expiresAt: '2026-10-27T00:00:00Z',
  questions: [{ __typename: 'InterviewSessionQuestion', id: 'question', content: 'Question', questionType: 'behavioral', position: 0, acceptedAnswerCount: 0, skipped: false }],
  messages: [], operations: [],
}
const pending = { questionId: 'question', recordingId: 'recording', expectedRevision: 0, submissionKey: 'stable-key' }
const query = { query: INTERVIEW_QUERY, variables: { id: 'session' } }
const subscription = { request: { query: INTERVIEW_UPDATED, variables: { id: 'session' } }, result: { data: { interviewSessionUpdated: snapshot } } }
function mount(mocks: MockLink.MockedResponse[]) {
  return renderHook(() => useInterviewSession('session', 'owner'), { wrapper: ({ children }) => <MockedProvider mocks={[subscription, ...mocks]}>{children}</MockedProvider> })
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('starts preparation with the selected length and trimmed career focus', async () => {
  const mocks = [{ request: { query: START_INTERVIEW, variables: { careerFocus: 'Laboratory', setup: { questionCount: 5, questionFormat: 'mixed', difficulty: 'realistic', interviewer: 'daniel', focusAreas: [] } } },
    result: { data: { startInterviewDemo: { __typename: 'StartInterviewDemoPayload', errors: [],
      interview: { ...snapshot, status: 'preparing', setup: { __typename: 'InterviewSetup', questionCount: 5, questionFormat: 'mixed', difficulty: 'realistic', interviewer: 'daniel', focusAreas: [] } } } } } }]
  const { result } = renderHook(() => useStartInterview(), { wrapper: ({ children }) => <MockedProvider mocks={mocks}>{children}</MockedProvider> })
  await act(async () => { expect(await result.current.start(' Laboratory ', { questionCount: 5, questionFormat: 'mixed', difficulty: 'realistic', interviewer: 'daniel', focusAreas: [] })).toBe('session') })
  expect(result.current.error).toBeNull()
})

describe('useInterviewSession', () => {
  it('keeps ambiguous submission recovery on failed abandon and clears it only after saved confirmation', async () => {
    savePendingSubmission('owner', 'session', pending)
    const abandonRequest = { query: ABANDON_INTERVIEW, variables: { interviewId: 'session' } }
    const { result } = mount([
      { request: query, result: { data: { interviewSession: snapshot } } },
      { request: abandonRequest, error: new Error('Disconnected') },
      { request: abandonRequest, result: { data: { abandonInterview: { __typename: 'AbandonInterviewPayload', interview: { ...snapshot, status: 'abandoned', revision: 1 }, errors: [] } } } },
    ])
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { expect(await result.current.abandonInterview()).toBe(false) })
    expect(loadPendingSubmission('owner', 'session')).toEqual(pending)
    expect(result.current.unresolved).toEqual(pending)
    await act(async () => { expect(await result.current.abandonInterview()).toBe(true) })
    expect(loadPendingSubmission('owner', 'session')).toBeNull()
    expect(result.current.unresolved).toBeNull()
    expect(result.current.interview?.status).toBe('abandoned')
  })
  it('reconciles an ambiguously accepted submission on reload without resending expired recording input', async () => {
    savePendingSubmission('owner', 'session', pending)
    const accepted = { ...snapshot, revision: 1, operations: [{ __typename: 'InterviewSessionOperation', id: 'operation', questionId: 'question', messageId: null, kind: 'turn', reviewTranscript: null, expectedRevision: null, status: 'accepted', failureCode: null, checkpoint: 'interviewer_finished', submissionKey: pending.submissionKey, canRetry: false }] }
    const resend = vi.fn(() => ({ data: { submitInterviewTurn: { interview: accepted, errors: [] } } }))
    const { result } = mount([
      { request: query, result: { data: { interviewSession: snapshot } } },
      { request: query, result: { data: { interviewSession: accepted } } },
      { request: { query: SUBMIT_TURN, variables: { input: { interviewId: 'session', ...pending } } }, result: resend },
    ])
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(() => result.current.checkSavedStatus(true))
    expect(result.current.unresolved).toBeNull()
    expect(resend).not.toHaveBeenCalled()
  })
  it('uploads exact signed headers and preserves the same submit identity after a lost reply', async () => {
    const key = '11111111-1111-4111-8111-111111111111'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(key)
    const put = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', put)
    const identity = { ...pending, submissionKey: key }
    const accepted = { ...snapshot, revision: 1, operations: [{ __typename: 'InterviewSessionOperation', id: 'operation', questionId: 'question', messageId: null, kind: 'turn', reviewTranscript: null, expectedRevision: null, status: 'accepted', failureCode: null, checkpoint: null, submissionKey: key, canRetry: false }] }
    const submitRequest = { query: SUBMIT_TURN, variables: { input: { interviewId: 'session', ...identity } } }
    const { result } = mount([
      { request: query, result: { data: { interviewSession: snapshot } } },
      { request: { query: AUTHORIZE_RECORDING, variables: { input: { interviewId: 'session', questionId: 'question', expectedRevision: 0, contentType: 'audio/webm', byteSize: 3, checksum: 'kAFQmDzST7DWlj99KOF/cg==' } } }, result: { data: { authorizeInterviewRecording: { __typename: 'AuthorizeInterviewRecordingPayload', errors: [], upload: { __typename: 'InterviewRecordingUpload', mediaId: 'recording', uploadUrl: 'https://storage.test/upload', headers: { 'Content-Type': 'audio/webm', 'Content-MD5': 'kAFQmDzST7DWlj99KOF/cg==' }, expiresIn: 60 } } } } },
      { request: { query: REGISTER_RECORDING, variables: { input: { interviewId: 'session', mediaId: 'recording' } } }, result: { data: { registerInterviewRecording: { __typename: 'RegisterInterviewRecordingPayload', interview: snapshot, errors: [] } } } },
      { request: submitRequest, error: new Error('Lost response') },
      { request: query, result: { data: { interviewSession: snapshot } } },
      { request: submitRequest, result: { data: { submitInterviewTurn: { __typename: 'SubmitInterviewTurnPayload', interview: accepted, errors: [] } } } },
    ])
    await waitFor(() => expect(result.current.loading).toBe(false))
    const blob = new Blob(['abc'], { type: 'audio/webm;codecs=opus' })
    Object.defineProperty(blob, 'arrayBuffer', { value: async () => new Uint8Array([97, 98, 99]).buffer })
    let discard = false
    await act(async () => { discard = await result.current.answer(blob) })
    expect(discard).toBe(true)
    expect(result.current.unresolved).toEqual(identity)
    expect(put).toHaveBeenCalledWith('https://storage.test/upload', expect.objectContaining({ method: 'PUT', credentials: 'omit', body: blob, headers: { 'Content-Type': 'audio/webm', 'Content-MD5': 'kAFQmDzST7DWlj99KOF/cg==' } }))
    await act(() => result.current.checkSavedStatus(true))
    expect(result.current.unresolved).toBeNull()
    expect(put).toHaveBeenCalledOnce()
  })
  it('keeps the recording available when the submitted upload is definitively expired', async () => {
    const key = '11111111-1111-4111-8111-111111111111'
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(key)
    const put = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', put)
    const identity = { ...pending, submissionKey: key }
    const submitRequest = { query: SUBMIT_TURN, variables: { input: { interviewId: 'session', ...identity } } }
    const { result } = mount([
      { request: query, result: { data: { interviewSession: snapshot } } },
      { request: { query: AUTHORIZE_RECORDING, variables: { input: { interviewId: 'session', questionId: 'question', expectedRevision: 0, contentType: 'audio/webm', byteSize: 3, checksum: 'kAFQmDzST7DWlj99KOF/cg==' } } }, result: { data: { authorizeInterviewRecording: { __typename: 'AuthorizeInterviewRecordingPayload', errors: [], upload: { __typename: 'InterviewRecordingUpload', mediaId: 'recording', uploadUrl: 'https://storage.test/upload', headers: { 'Content-Type': 'audio/webm', 'Content-MD5': 'kAFQmDzST7DWlj99KOF/cg==' }, expiresIn: 60 } } } } },
      { request: { query: REGISTER_RECORDING, variables: { input: { interviewId: 'session', mediaId: 'recording' } } }, result: { data: { registerInterviewRecording: { __typename: 'RegisterInterviewRecordingPayload', interview: snapshot, errors: [] } } } },
      { request: submitRequest, result: { data: { submitInterviewTurn: { __typename: 'SubmitInterviewTurnPayload', interview: null, errors: ['This recording has expired.'] } } } },
    ])
    await waitFor(() => expect(result.current.loading).toBe(false))
    const blob = new Blob(['abc'], { type: 'audio/webm;codecs=opus' })
    Object.defineProperty(blob, 'arrayBuffer', { value: async () => new Uint8Array([97, 98, 99]).buffer })
    let discard = false
    await act(async () => { discard = await result.current.answer(blob) })
    expect(discard).toBe(false)
    expect(result.current.unresolved).toBeNull()
    expect(loadPendingSubmission('owner', 'session')).toBeNull()
    expect(result.current.error).toBe('This recording has expired.')
    expect(put).toHaveBeenCalledWith('https://storage.test/upload', expect.objectContaining({ method: 'PUT', credentials: 'omit', body: blob, headers: { 'Content-Type': 'audio/webm', 'Content-MD5': 'kAFQmDzST7DWlj99KOF/cg==' } }))
    expect(put).toHaveBeenCalledOnce()
  })
  it.each(['The interview changed. Reload and try again.', 'This recording has expired.'])('releases a definitively rejected identity: %s', async (message) => {
    savePendingSubmission('owner', 'session', pending)
    const { result } = mount([
      { request: query, result: { data: { interviewSession: snapshot } } },
      { request: query, result: { data: { interviewSession: snapshot } } },
      { request: { query: SUBMIT_TURN, variables: { input: { interviewId: 'session', ...pending } } }, result: { data: { submitInterviewTurn: { __typename: 'SubmitInterviewTurnPayload', interview: null, errors: [message] } } } },
    ])
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(() => result.current.checkSavedStatus(true))
    expect(result.current.error).toBe(message)
    expect(result.current.unresolved).toBeNull()
    expect(loadPendingSubmission('owner', 'session')).toBeNull()
  })
  it('never resends after an authorization error during reconciliation', async () => {
    savePendingSubmission('owner', 'session', pending)
    const resend = vi.fn(() => ({ data: {} }))
    const { result } = mount([
      { request: query, result: { data: { interviewSession: snapshot } } },
      { request: query, result: { errors: [new GraphQLError('Unauthorized')] } },
      { request: { query: SUBMIT_TURN, variables: { input: { interviewId: 'session', ...pending } } }, result: resend },
    ])
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(() => result.current.checkSavedStatus(true))
    expect(result.current.unresolved).toEqual(pending)
    expect(resend).not.toHaveBeenCalled()
    expect(result.current.error).toContain('Unauthorized')
  })
})

it('begins reviewed preparation explicitly and updates the owned snapshot', async () => {
  const ready = { ...snapshot, status: 'ready' }
  const active = { ...snapshot, revision: 1 }
  const begin = vi.fn(() => ({ data: { beginInterview: { __typename: 'BeginInterviewPayload', interview: active, errors: [] } } }))
  const { result } = mount([
    { request: query, result: { data: { interviewSession: ready } } },
    { request: { query: BEGIN_INTERVIEW, variables: { interviewId: 'session' } }, result: begin, delay: 20 },
  ])
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(begin).not.toHaveBeenCalled()
  await act(async () => { await Promise.all([result.current.beginInterview(), result.current.beginInterview()]) })
  expect(begin).toHaveBeenCalledOnce()
  expect(result.current.interview?.revision).toBe(1)
  expect(result.current.error).toBeNull()
})

it('preserves role review after a failed begin and allows an explicit retry', async () => {
  const ready = { ...snapshot, status: 'ready' }
  const active = { ...snapshot, revision: 1 }
  const request = { query: BEGIN_INTERVIEW, variables: { interviewId: 'session' } }
  const { result } = mount([
    { request: query, result: { data: { interviewSession: ready } } },
    { request, error: new Error('Lost begin response') },
    { request, result: { data: { beginInterview: { __typename: 'BeginInterviewPayload', interview: active, errors: [] } } } },
  ])
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(() => result.current.beginInterview())
  expect(result.current.error).toContain('Lost begin response')
  await act(() => result.current.beginInterview())
  expect(result.current.interview?.revision).toBe(1)
})


it('recovers an unsaved recognized submission from retained audio after an owned read without storing text', async () => {
  const recognized = { ...pending, transcriptionMode: 'browser' as const, transcriptDigest: 'a'.repeat(64) }
  savePendingSubmission('owner', 'session', recognized)
  expect(JSON.stringify(loadPendingSubmission('owner', 'session'))).not.toContain('candidateTranscript')
  const key = '11111111-1111-4111-8111-111111111111'
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(key)
  const fallback = { ...pending, submissionKey: key }
  const accepted = { ...snapshot, revision: 1, operations: [{ __typename: 'InterviewSessionOperation', id: 'operation', questionId: 'question', messageId: null, kind: 'turn', reviewTranscript: null, expectedRevision: null, status: 'pending', failureCode: null, checkpoint: null, submissionKey: key, canRetry: false }] }
  const submit = vi.fn(() => ({ data: { submitInterviewTurn: { __typename: 'SubmitInterviewTurnPayload', interview: accepted, errors: [] } } }))
  const { result } = mount([
    { request: query, result: { data: { interviewSession: snapshot } } },
    { request: query, result: { data: { interviewSession: snapshot } } },
    { request: { query: SUBMIT_TURN, variables: { input: { interviewId: 'session', ...fallback } } }, result: submit },
  ])
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(submit).not.toHaveBeenCalled()
  await act(() => result.current.checkSavedStatus(true))
  expect(submit).toHaveBeenCalledOnce()
  expect(result.current.unresolved).toBeNull()
})

it('submits canonical typed text without audio and persists only its identity', async () => {
  const key = '11111111-1111-4111-8111-111111111111'
  vi.stubGlobal('crypto', { randomUUID: () => key, subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).fill(1).buffer) } })
  const text = 'I rebuilt the scheduler and checked duplicates stopped.'
  const identity = { questionId: 'question', expectedRevision: 0, submissionKey: key, transcriptionMode: 'typed', transcriptDigest: '01'.repeat(32) }
  const accepted = { ...snapshot, revision: 1, operations: [{ __typename: 'InterviewSessionOperation', id: 'operation', questionId: 'question', messageId: null, kind: 'turn', reviewTranscript: null, expectedRevision: null, status: 'pending', failureCode: null, checkpoint: null, submissionKey: key, canRetry: false }] }
  const submit = vi.fn(() => ({ data: { submitInterviewTurn: { __typename: 'SubmitInterviewTurnPayload', interview: accepted, errors: [] } } }))
  const { result } = mount([
    { request: query, result: { data: { interviewSession: snapshot } } },
    { request: { query: SUBMIT_TURN, variables: { input: { interviewId: 'session', ...identity, candidateTranscript: text } } }, result: submit },
  ])
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(async () => { expect(await result.current.answerText(text)).toBe(true) })
  expect(submit).toHaveBeenCalledOnce()
  expect(result.current.unresolved).toBeNull()
  expect(JSON.stringify(localStorage)).not.toContain(text)
})

it('reconciles a lost typed receipt and explicitly resends the same retained text and identity', async () => {
  const key = '11111111-1111-4111-8111-111111111111'
  vi.stubGlobal('crypto', { randomUUID: () => key, subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).fill(1).buffer) } })
  const text = 'My edited answer stays exactly this way.'
  const identity = { questionId: 'question', expectedRevision: 0, submissionKey: key, transcriptionMode: 'typed', transcriptDigest: '01'.repeat(32) }
  const request = { query: SUBMIT_TURN, variables: { input: { interviewId: 'session', ...identity, candidateTranscript: text } } }
  const accepted = { ...snapshot, revision: 1, operations: [{ __typename: 'InterviewSessionOperation', id: 'operation', questionId: 'question', messageId: null, kind: 'turn', reviewTranscript: null, expectedRevision: null, status: 'pending', failureCode: null, checkpoint: null, submissionKey: key, canRetry: false }] }
  const resend = vi.fn(() => ({ data: { submitInterviewTurn: { __typename: 'SubmitInterviewTurnPayload', interview: accepted, errors: [] } } }))
  const { result } = mount([
    { request: query, result: { data: { interviewSession: snapshot } } },
    { request, error: new Error('Lost response') },
    { request: query, result: { data: { interviewSession: snapshot } } },
    { request, result: resend },
  ])
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(async () => { expect(await result.current.answerText(text)).toBe(false) })
  expect(loadPendingSubmission('owner', 'session')).toEqual(identity)
  expect(JSON.stringify(localStorage)).not.toContain(text)
  expect(resend).not.toHaveBeenCalled()
  await act(() => result.current.checkSavedStatus(true))
  expect(resend).toHaveBeenCalledOnce()
  expect(result.current.unresolved).toBeNull()
})

it('asks for re-entry after reload when a typed identity is absent from the server, without replaying a write', async () => {
  const identity = { questionId: 'question', expectedRevision: 0, submissionKey: 'typed-key', transcriptionMode: 'typed' as const, transcriptDigest: 'a'.repeat(64) }
  savePendingSubmission('owner', 'session', identity)
  const { result } = mount([
    { request: query, result: { data: { interviewSession: snapshot } } },
    { request: query, result: { data: { interviewSession: snapshot } } },
  ])
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.unresolved).toEqual(identity)
  await act(() => result.current.checkSavedStatus(true))
  expect(result.current.error).toContain('type your answer again')
  expect(result.current.unresolved).toBeNull()
  expect(loadPendingSubmission('owner', 'session')).toBeNull()
})

it('uploads recorded review once and retries its exact capture after a lost receipt without submitting an answer', async () => {
  sessionStorage.clear()
  const put = vi.fn().mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', put)
  const startRequest = { query: START_RECORDED_TRANSCRIPTION, variables: { input: { interviewId: 'session', questionId: 'question', expectedRevision: 0, recordingId: 'recording' } } }
  const { result } = mount([
    { request: query, result: { data: { interviewSession: snapshot } } },
    { request: { query: AUTHORIZE_RECORDING, variables: { input: { interviewId: 'session', questionId: 'question', expectedRevision: 0, contentType: 'audio/webm', byteSize: 3, checksum: 'kAFQmDzST7DWlj99KOF/cg==' } } }, result: { data: { authorizeInterviewRecording: { __typename: 'AuthorizeInterviewRecordingPayload', errors: [], upload: { __typename: 'InterviewRecordingUpload', mediaId: 'recording', uploadUrl: 'https://storage.test/upload', headers: { 'Content-Type': 'audio/webm' }, expiresIn: 60 } } } } },
    { request: { query: REGISTER_RECORDING, variables: { input: { interviewId: 'session', mediaId: 'recording' } } }, result: { data: { registerInterviewRecording: { __typename: 'RegisterInterviewRecordingPayload', interview: snapshot, errors: [] } } } },
    { request: startRequest, error: new Error('Lost capture receipt') },
    { request: startRequest, result: { data: { startRecordedTranscription: { __typename: 'StartRecordedTranscriptionPayload', operationId: 'capture', interview: snapshot, errors: [] } } } },
  ])
  await waitFor(() => expect(result.current.loading).toBe(false))
  const blob = new Blob(['abc'], { type: 'audio/webm' })
  await act(async () => expect(await result.current.transcribeRecording(blob)).toBeNull())
  await act(async () => expect(await result.current.transcribeRecording(blob)).toBe('capture'))
  expect(put).toHaveBeenCalledOnce()
  expect(result.current.interview?.revision).toBe(0)
  expect(result.current.interview?.operations).toEqual([])
  expect(loadPendingSubmission('owner', 'session')).toBeNull()
})

it('retries a lost skip response with the same question revision and identity', async () => {
  const key = '11111111-1111-4111-8111-111111111111'
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(key)
  const request = { query: SKIP_QUESTION, variables: { input: { interviewId: 'session', questionId: 'question', expectedRevision: 0, submissionKey: key } } }
  const completed = { ...snapshot, status: 'completed', revision: 1, questions: [{...snapshot.questions[0], skipped: true}] }
  const { result } = mount([
    { request: query, result: { data: { interviewSession: snapshot } } },
    { request, error: new Error('Connection lost') },
    { request, result: { data: { skipInterviewQuestion: { __typename: 'SkipInterviewQuestionPayload', errors: [], interview: completed } } } },
  ])
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(async () => { expect(await result.current.skipQuestion()).toBe(false) })
  expect(result.current.interview?.revision).toBe(0)
  await act(async () => { expect(await result.current.skipQuestion()).toBe(true) })
  expect(result.current.interview?.status).toBe('completed')
  expect(result.current.interview?.questions[0].skipped).toBe(true)
  expect(crypto.randomUUID).toHaveBeenCalledOnce()
})

it('reconciles the original skip when live progression advances after a lost response', async () => {
  const key = '11111111-1111-4111-8111-111111111111'
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(key)
  const advanced = { ...snapshot, revision: 1, currentQuestionPosition: 1, questions: [
    {...snapshot.questions[0], skipped: true}, {...snapshot.questions[0], id: 'next', position: 1, skipped: false},
  ] }
  const request = { query: SKIP_QUESTION, variables: { input: { interviewId: 'session', questionId: 'question', expectedRevision: 0, submissionKey: key } } }
  const mocks = [
    { request: query, result: { data: { interviewSession: snapshot } } },
    { request: { query: INTERVIEW_UPDATED, variables: { id: 'session' } }, delay: 250, result: { data: { interviewSessionUpdated: advanced } } },
    { request, error: new Error('Connection lost') },
    { request, result: { data: { skipInterviewQuestion: { __typename: 'SkipInterviewQuestionPayload', errors: [], interview: advanced } } } },
  ]
  const { result } = renderHook(() => useInterviewSession('session', 'owner'), { wrapper: ({ children }) => <MockedProvider mocks={mocks}>{children}</MockedProvider> })
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(async () => { expect(await result.current.skipQuestion()).toBe(false) })
  await waitFor(() => expect(result.current.interview?.revision).toBe(1))
  expect(result.current.skipPending).toBe(true)
  await act(async () => { expect(await result.current.answerText('Do not submit while unresolved')).toBe(false) })
  await act(async () => { expect(await result.current.skipQuestion()).toBe(true) })
  expect(result.current.skipPending).toBe(false)
  expect(result.current.interview?.currentQuestionPosition).toBe(1)
  expect(crypto.randomUUID).toHaveBeenCalledOnce()
})
