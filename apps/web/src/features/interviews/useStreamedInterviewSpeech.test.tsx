/** Streamed interviewer text becomes speech while a browser-voice turn runs, then hands off to saved text. */
import { act, renderHook, waitFor } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { InterviewSnapshotFragment } from '@/graphql/generated/graphql'
import { AUTHORIZE_INTERVIEW_OUTPUT } from './interviewOperations'
import { useStreamedInterviewSpeech } from './useStreamedInterviewSpeech'

class Socket {
  static instances: Socket[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  constructor() { Socket.instances.push(this) }
  send(value: string) { this.sent.push(value) }
  close() {}
  receive(value: unknown) { act(() => this.onmessage?.({ data: JSON.stringify(value) })) }
}
const event = (type: string, extra = {}) => ({ type, version: 1, feature: 'interviews', operation_id: 'turn', attempt_id: 'attempt', claim_generation: 1, ...extra })
const question = { __typename: 'InterviewSessionQuestion' as const, id: 'question', content: 'Describe a project.', questionType: 'behavioral', position: 0, acceptedAnswerCount: 0, skipped: false }
const message = (id: string, kind: string, content: string, acknowledgement: string | null = null) => ({
  __typename: 'InterviewSessionMessage' as const, id, questionId: 'question', kind, position: 0, content, avoided: false, acknowledgement,
  spokenContent: [acknowledgement, content].filter(Boolean).join('\n\n'), careerReferences: null, clarification: null,
})
const turn = (status: string) => ({ __typename: 'InterviewSessionOperation' as const, id: 'turn', questionId: 'question', messageId: null, kind: 'turn', status,
  failureCode: null, checkpoint: null, submissionKey: 'key', canRetry: false, reviewTranscript: null, expectedRevision: 0 })
const opening = message('opening', 'opening', 'Describe a project.')
function snapshot(status: string, messages = [opening], speechPlaybackMode = 'browser') {
  return { __typename: 'InterviewSession', id: 'session', status: 'active', interviewType: 'basic', executionMode: 'real', speechPlaybackMode,
    preparedRole: {}, revision: 1, answerCap: 2, currentQuestionPosition: 0, expiresAt: '2026-12-01T00:00:00Z', feedback: null, jobContext: null,
    setup: null, questions: [question], messages, operations: [turn(status)] } as unknown as InterviewSnapshotFragment
}
const authorize = { request: { query: AUTHORIZE_INTERVIEW_OUTPUT, variables: { input: { feature: 'interviews', operationId: 'turn' } } },
  result: { data: { authorizeAiExecutionStream: { __typename: 'AuthorizeAiExecutionStreamPayload', token: 'observer-capability', expiresAt: '2026-12-01T00:01:00Z', errors: [] } } } }
function mount(initial: InterviewSnapshotFragment, consume = vi.fn()) {
  return renderHook(({ interview }) => useStreamedInterviewSpeech(interview, consume), {
    initialProps: { interview: initial },
    wrapper: ({ children }) => <MockedProvider mocks={[authorize]}>{children}</MockedProvider>,
  })
}
async function attachedSocket() {
  await waitFor(() => expect(Socket.instances.length).toBe(1))
  const socket = Socket.instances[0]
  act(() => socket.onopen?.())
  expect(JSON.parse(socket.sent[0])).toMatchObject({ type: 'authorize', token: 'observer-capability' })
  socket.receive(event('attached'))
  return socket
}
beforeEach(() => { Socket.instances = []; vi.stubGlobal('WebSocket', Socket) })
afterEach(() => vi.unstubAllGlobals())

it('streams the running follow-up and finishes with the saved text when it matches', async () => {
  const consume = vi.fn()
  const view = mount(snapshot('running'), consume)
  const socket = await attachedSocket()
  socket.receive(event('delta', { text: 'You cut the wait.', cursor: '1-0' }))
  expect(view.result.current).toEqual({ key: 'stream:turn', text: 'You cut the wait.', streaming: true })
  socket.receive(event('delta', { text: '\n\nHow did you measure it?', cursor: '2-0' }))
  const saved = message('follow-up', 'follow_up', 'How did you measure it?', 'You cut the wait.')
  view.rerender({ interview: snapshot('accepted', [opening, message('answer', 'answer', 'I shortened it.'), saved]) })
  expect(view.result.current).toEqual({ key: 'stream:turn', text: 'You cut the wait.\n\nHow did you measure it?', streaming: false })
  // The saved reply must not autoplay again as new speech.
  expect(consume).toHaveBeenCalledWith('follow-up')
})

it('leaves a saved reply that differs from the streamed text to normal playback', async () => {
  const view = mount(snapshot('running'))
  const socket = await attachedSocket()
  socket.receive(event('delta', { text: 'A different draft.', cursor: '1-0' }))
  view.rerender({ interview: snapshot('accepted', [opening, message('answer', 'answer', 'I shortened it.'), message('follow-up', 'follow_up', 'What changed?')]) })
  expect(view.result.current).toBeNull()
})

it('stops streamed speech when the stream fails', async () => {
  const view = mount(snapshot('running'))
  const socket = await attachedSocket()
  socket.receive(event('delta', { text: 'You cut the wait.', cursor: '1-0' }))
  socket.receive(event('failed', { cursor: '2-0' }))
  expect(view.result.current).toBeNull()
})

it('does not observe provider playback', async () => {
  const view = mount(snapshot('running', [opening], 'provider'))
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
  expect(Socket.instances).toHaveLength(0)
  expect(view.result.current).toBeNull()
})
