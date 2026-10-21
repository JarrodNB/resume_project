/** Reload and network recovery use a canonical owned read before any explicit resend. */
import { act, renderHook, waitFor } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing/react'
import type { MockLink } from '@apollo/client/testing'
import { GraphQLError } from 'graphql'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useInterviewSession } from './useInterviewSession'
import { loadPendingSubmission, savePendingSubmission } from './pendingSubmission'
import { ABANDON_INTERVIEW, AUTHORIZE_RECORDING, BEGIN_INTERVIEW, INTERVIEW_QUERY, INTERVIEW_UPDATED, REGISTER_RECORDING, SUBMIT_TURN } from './interviewOperations'
const snapshot = {
  __typename: 'InterviewSession' as const, id: 'session', status: 'active', interviewType: 'basic', executionMode: 'fake', preparedRole: {}, revision: 0, answerCap: 2, currentQuestionPosition: 0, expiresAt: '2026-10-27T00:00:00Z',
  questions: [{ __typename: 'InterviewSessionQuestion', id: 'question', content: 'Question', questionType: 'behavioral', position: 0, acceptedAnswerCount: 0 }],
  messages: [], operations: [],
}
const pending = { questionId: 'question', recordingId: 'recording', expectedRevision: 0, submissionKey: 'stable-key' }
const query = { query: INTERVIEW_QUERY, variables: { id: 'session' } }
const subscription = { request: { query: INTERVIEW_UPDATED, variables: { id: 'session' } }, result: { data: { interviewSessionUpdated: snapshot } } }
function mount(mocks: MockLink.MockedResponse[]) {
  return renderHook(() => useInterviewSession('session', 'owner'), { wrapper: ({ children }) => <MockedProvider mocks={[subscription, ...mocks]}>{children}</MockedProvider> })
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
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
    const accepted = { ...snapshot, revision: 1, operations: [{ __typename: 'InterviewSessionOperation', id: 'operation', questionId: 'question', messageId: null, kind: 'turn', status: 'accepted', failureCode: null, checkpoint: 'interviewer_finished', submissionKey: pending.submissionKey, canRetry: false }] }
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
    const accepted = { ...snapshot, revision: 1, operations: [{ __typename: 'InterviewSessionOperation', id: 'operation', questionId: 'question', messageId: null, kind: 'turn', status: 'accepted', failureCode: null, checkpoint: null, submissionKey: key, canRetry: false }] }
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
