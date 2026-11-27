/** Streamed interviewer text becomes speech while a browser-voice turn runs, then hands off to saved text.
 * A saved reply that differs from speech already heard is left on screen without speaking it again. */
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
const question = { __typename: 'InterviewSessionQuestion' as const, id: 'question', content: 'Describe a project.', questionType: 'behavioral', position: 0, acceptedAnswerCount: 0, skipped: false, liveFeedback: null }
const lastQuestion = { ...question, id: 'last-question', content: 'Tell me about a conflict.', position: 1 }
const message = (id: string, kind: string, content: string, acknowledgement: string | null = null) => ({
  __typename: 'InterviewSessionMessage' as const, id, questionId: 'question', kind, position: 0, content, avoided: false, acknowledgement,
  spokenContent: [acknowledgement, content].filter(Boolean).join('\n\n'), careerReferences: null, clarification: null,
})
const turn = (status: string) => ({ __typename: 'InterviewSessionOperation' as const, id: 'turn', questionId: 'question', messageId: null, kind: 'turn', status,
  failureCode: null, checkpoint: null, submissionKey: 'key', canRetry: false, reviewTranscript: null, expectedRevision: 0 })
const opening = message('opening', 'opening', 'Describe a project.')
function snapshot(status: string, messages = [opening], speechPlaybackMode = 'browser', currentQuestionPosition = 0) {
  return { __typename: 'InterviewSession', id: 'session', status: 'active', interviewType: 'basic', conversationMode: 'TURN_BASED', executionMode: 'real', speechPlaybackMode,
    preparedRole: {}, revision: 1, answerCap: 2, currentQuestionPosition, expiresAt: '2026-12-01T00:00:00Z', feedback: null, jobContext: null,
    setup: null, questions: [question, lastQuestion], messages, operations: [turn(status)] } as unknown as InterviewSnapshotFragment
}
const authorize = { request: { query: AUTHORIZE_INTERVIEW_OUTPUT, variables: { input: { feature: 'interviews', operationId: 'turn' } } },
  result: { data: { authorizeAiExecutionStream: { __typename: 'AuthorizeAiExecutionStreamPayload', token: 'observer-capability', expiresAt: '2026-12-01T00:01:00Z', errors: [] } } } }
function mount(initial: InterviewSnapshotFragment, consume = vi.fn()) {
  return renderHook(({ interview }) => useStreamedInterviewSpeech(interview, consume), {
    initialProps: { interview: initial },
    wrapper: ({ children }) => <MockedProvider mocks={[authorize, authorize]}>{children}</MockedProvider>,
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
  expect(view.result.current.speech).toEqual({ key: 'stream:turn', text: 'You cut the wait.', streaming: true })
  socket.receive(event('delta', { text: '\n\nHow did you measure it?', cursor: '2-0' }))
  const saved = message('follow-up', 'follow_up', 'How did you measure it?', 'You cut the wait.')
  view.rerender({ interview: snapshot('accepted', [opening, message('answer', 'answer', 'I shortened it.'), saved]) })
  expect(view.result.current.speech).toEqual({ key: 'stream:turn', text: 'You cut the wait.\n\nHow did you measure it?', streaming: false })
  // The saved reply must not autoplay again as new speech.
  expect(consume).toHaveBeenCalledWith('follow-up')
})

const differentReply = () => snapshot('accepted', [opening, message('answer', 'answer', 'I shortened it.'), message('follow-up', 'follow_up', 'What changed?')])

it('leaves a saved reply that differs from unheard streamed text to normal playback', async () => {
  const consume = vi.fn()
  const view = mount(snapshot('running'), consume)
  const socket = await attachedSocket()
  socket.receive(event('delta', { text: 'A different draft.', cursor: '1-0' }))
  view.rerender({ interview: differentReply() })
  expect(view.result.current.speech).toBeNull()
  expect(consume).not.toHaveBeenCalled()
})

it('stops and does not autoplay a saved reply that differs from streamed speech already heard', async () => {
  const consume = vi.fn()
  const view = mount(snapshot('running'), consume)
  const socket = await attachedSocket()
  socket.receive(event('delta', { text: 'A different draft.', cursor: '1-0' }))
  act(() => view.result.current.speechStarted('another-message'))
  act(() => view.result.current.speechStarted('stream:turn'))
  view.rerender({ interview: differentReply() })
  expect(view.result.current.speech).toBeNull()
  expect(consume).toHaveBeenCalledWith('follow-up')
})

it('keeps streamed text when the stream ends early, and stops once the turn fails', async () => {
  const view = mount(snapshot('running'))
  const socket = await attachedSocket()
  socket.receive(event('delta', { text: 'You cut the wait.', cursor: '1-0' }))
  socket.receive(event('failed', { cursor: '2-0' }))
  expect(view.result.current.speech).toEqual({ key: 'stream:turn', text: 'You cut the wait.', streaming: true })
  view.rerender({ interview: snapshot('failed') })
  expect(view.result.current.speech).toBeNull()
})

it('does not observe provider playback', async () => {
  const view = mount(snapshot('running', [opening], 'provider'))
  await act(() => new Promise((resolve) => setTimeout(resolve, 200)))
  expect(Socket.instances).toHaveLength(0)
  expect(view.result.current.speech).toBeNull()
})

it('leaves a later reply that no turn produced, such as the question after Skip, to normal playback', async () => {
  const consume = vi.fn()
  const view = mount(snapshot('running'), consume)
  const socket = await attachedSocket()
  socket.receive(event('delta', { text: 'You cut the wait.\n\nHow did you measure it?', cursor: '1-0' }))
  act(() => view.result.current.speechStarted('stream:turn'))
  const answer = message('answer', 'answer', 'I shortened it.')
  const saved = message('follow-up', 'follow_up', 'How did you measure it?', 'You cut the wait.')
  view.rerender({ interview: snapshot('accepted', [opening, answer, saved]) })
  expect(consume).toHaveBeenCalledTimes(1)
  // Skip adds the next question without a new turn operation.
  view.rerender({ interview: snapshot('accepted', [opening, answer, saved, message('next', 'opening', 'Tell me about a conflict.')]) })
  expect(view.result.current.speech).toBeNull()
  expect(consume).toHaveBeenCalledTimes(1)
})

it('does not replay text a failed attempt streamed when the same turn is retried', async () => {
  const view = mount(snapshot('running'))
  const first = await attachedSocket()
  first.receive(event('delta', { text: 'A draft from the failed attempt.', cursor: '1-0' }))
  act(() => view.result.current.speechStarted('stream:turn'))
  // The failure snapshot can arrive before the stream's own failed event.
  view.rerender({ interview: snapshot('failed') })
  view.rerender({ interview: snapshot('running') })
  expect(view.result.current.speech).toBeNull()
  await waitFor(() => expect(Socket.instances.length).toBe(2))
})

it('does not stream speech on the last question, where completing the interview would cut the voice off', async () => {
  const view = mount(snapshot('running', [opening], 'browser', 1))
  await act(() => new Promise((resolve) => setTimeout(resolve, 200)))
  expect(Socket.instances).toHaveLength(0)
  expect(view.result.current.speech).toBeNull()
})

it('carries on with the saved reply when the stream resets just as the turn is accepted', async () => {
  const consume = vi.fn()
  const view = mount(snapshot('running'), consume)
  const socket = await attachedSocket()
  socket.receive(event('delta', { text: 'You cut the wait.\n\n', cursor: '1-0' }))
  act(() => view.result.current.speechStarted('stream:turn'))
  // The relay can see the accepted turn before the final completed event and ask for saved state.
  socket.receive({ type: 'reset', code: 'saved_state_required' })
  const saved = message('follow-up', 'follow_up', 'How did you measure it?', 'You cut the wait.')
  view.rerender({ interview: snapshot('accepted', [opening, message('answer', 'answer', 'I shortened it.'), saved]) })
  expect(view.result.current.speech).toEqual({ key: 'stream:turn', text: 'You cut the wait.\n\nHow did you measure it?', streaming: false })
  expect(consume).toHaveBeenCalledWith('follow-up')
})
