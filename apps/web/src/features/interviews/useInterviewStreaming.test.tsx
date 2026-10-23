/** The browser authorizes a stream through the owned GraphQL interface before provider audio starts. */
import { act, renderHook } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing/react'
import { afterEach, expect, it, vi } from 'vitest'
import { startStreamingTranscription } from './streamingTranscription'
import { AUTHORIZE_TRANSCRIPTION, useInterviewStreaming } from './useInterviewStreaming'

vi.mock('./streamingTranscription', () => ({ startStreamingTranscription: vi.fn() }))
afterEach(() => vi.clearAllMocks())
const snapshot = { id: 'session', revision: 3, currentQuestionPosition: 2, questions: [{ id: 'old-question', position: 1 }, { id: 'current-question', position: 2 }] }

it('requests the current owned question and revision and keeps its capability in the adapter', async () => {
  const grant = { captureId: 'capture', token: 'opaque' }
  const authorizeResult = vi.fn(() => ({ data: { authorizeInterviewTranscription: { __typename: 'AuthorizeInterviewTranscriptionPayload', ...grant, errors: [] } } }))
  const mocks = [{ request: { query: AUTHORIZE_TRANSCRIPTION, variables: { input: { interviewId: 'session', questionId: 'current-question', expectedRevision: 3 } } }, result: authorizeResult }]
  const { result } = renderHook(() => useInterviewStreaming(snapshot), { wrapper: ({children}) => <MockedProvider mocks={mocks}>{children}</MockedProvider> })
  const callbacks = { text: vi.fn(), fallback: vi.fn() }
  result.current({} as MediaStream, callbacks)
  const authorize = vi.mocked(startStreamingTranscription).mock.calls[0][2]
  await act(async () => { expect(await authorize()).toEqual(grant) })
  expect(authorizeResult).toHaveBeenCalledOnce()
})

it('rejects denied authorization so the adapter can retain recorded fallback', async () => {
  const mocks = [{ request: { query: AUTHORIZE_TRANSCRIPTION, variables: { input: { interviewId: 'session', questionId: 'current-question', expectedRevision: 3 } } }, result: { data: { authorizeInterviewTranscription: { captureId: null, token: null, errors: ['Interview revision is stale'] } } } }]
  const { result } = renderHook(() => useInterviewStreaming(snapshot), { wrapper: ({children}) => <MockedProvider mocks={mocks}>{children}</MockedProvider> })
  result.current({} as MediaStream, { text: vi.fn(), fallback: vi.fn() })
  const authorize = vi.mocked(startStreamingTranscription).mock.calls[0][2]
  await act(async () => { await expect(authorize()).rejects.toThrow('Interview revision is stale') })
})
