/** Checks the live room adapter's wiring against a stand-in for the LiveKit SDK (no network). */
import { act, renderHook, waitFor } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing/react'
import type { MockLink } from '@apollo/client/testing'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { JOIN_LIVE_INTERVIEW } from './interviewOperations'
import { useLiveInterviewRoom } from './useLiveInterviewRoom'

type TextHandler = (reader: AsyncIterable<string> & { info: { id: string; attributes?: Record<string, string> } }, participant: { identity: string }) => void
type FakeRoom = { handlers: Map<string, (...values: unknown[]) => void>; textHandlers: Map<string, TextHandler>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; setMicrophoneEnabled: ReturnType<typeof vi.fn> }
const { rooms } = vi.hoisted(() => ({ rooms: [] as FakeRoom[] }))
vi.mock('livekit-client', () => {
  class Room {
    handlers = new Map<string, (...values: unknown[]) => void>()
    textHandlers = new Map<string, TextHandler>()
    connect = vi.fn().mockResolvedValue(undefined)
    disconnect = vi.fn().mockResolvedValue(undefined)
    setMicrophoneEnabled = vi.fn().mockResolvedValue(undefined)
    remoteParticipants = new Map()
    localParticipant = { identity: 'user-owner', setMicrophoneEnabled: this.setMicrophoneEnabled }
    constructor() { rooms.push(this) }
    on(event: string, handler: (...values: unknown[]) => void) { this.handlers.set(event, handler); return this }
    registerTextStreamHandler(topic: string, handler: TextHandler) { this.textHandlers.set(topic, handler) }
  }
  return { Room, RoomEvent: { ParticipantConnected: 'participantConnected', ParticipantAttributesChanged: 'participantAttributesChanged', TrackSubscribed: 'trackSubscribed', Disconnected: 'disconnected' }, Track: { Kind: { Audio: 'audio' } } }
})

/** A text stream that yields its chunks, like a LiveKit transcription segment. */
function textStream(segmentId: string, chunks: string[]) {
  return { info: { id: `stream-${segmentId}-${chunks.join('')}`, attributes: { 'lk.segment_id': segmentId } },
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk } }
}

function joinMock(payload: Record<string, unknown>): MockLink.MockedResponse {
  return { request: { query: JOIN_LIVE_INTERVIEW, variables: { interviewId: 'session' } }, result: { data: { joinLiveInterview: {
    __typename: 'JoinLiveInterviewPayload', url: null, token: null, roomName: null, expiresAt: null, interview: null, errors: [], errorCode: null, ...payload } } } }
}
function render(mock: MockLink.MockedResponse) {
  const wrapper = ({ children }: { children: ReactNode }) => <MockedProvider mocks={[mock]}>{children}</MockedProvider>
  return renderHook(() => useLiveInterviewRoom('session'), { wrapper })
}

beforeEach(() => { rooms.length = 0 })

it('joins through Rails, connects with the token, enables the microphone and notices the agent', async () => {
  const view = render(joinMock({ url: 'wss://live.test', token: 'join-token', roomName: 'room', expiresAt: '2099-01-01T00:00:00Z' }))
  expect(view.result.current.status).toBe('joining')
  await waitFor(() => expect(view.result.current.status).toBe('connected'))
  const room = rooms.at(-1)!
  expect(room.connect).toHaveBeenCalledWith('wss://live.test', 'join-token')
  expect(room.setMicrophoneEnabled).toHaveBeenCalledWith(true)
  expect(view.result.current.agentJoined).toBe(false)
  act(() => room.handlers.get('participantConnected')!({ isAgent: false, attributes: {} }))
  expect(view.result.current.agentJoined).toBe(false)
  act(() => room.handlers.get('participantConnected')!({ isAgent: true, attributes: {} }))
  expect(view.result.current.agentJoined).toBe(true)
  view.unmount()
  expect(room.disconnect).toHaveBeenCalled()
})

it('fails with the Rails refusal without connecting', async () => {
  const view = render(joinMock({ errors: ['This interview is not a live interview'] }))
  await waitFor(() => expect(view.result.current).toMatchObject({ status: 'failed', error: 'This interview is not a live interview' }))
  expect(rooms.every((room) => !room.connect.mock.calls.length)).toBe(true)
})

async function connectedRoom() {
  const view = render(joinMock({ url: 'wss://live.test', token: 'join-token', roomName: 'room', expiresAt: '2099-01-01T00:00:00Z' }))
  await waitFor(() => expect(view.result.current.status).toBe('connected'))
  return { view, room: rooms.at(-1)! }
}

it('shows captions for both sides, replacing interim text with the final text per segment', async () => {
  const { view, room } = await connectedRoom()
  const transcription = room.textHandlers.get('lk.transcription')!
  await act(async () => { transcription(textStream('agent-1', ['Hello, ', 'welcome. ', 'Tell me about a project.']), { identity: 'agent-xyz' }) })
  await act(async () => { transcription(textStream('user-1', ['I worked']), { identity: 'user-owner' }) })
  await act(async () => { transcription(textStream('user-1', ['I worked on a lab system.']), { identity: 'user-owner' }) })
  expect(view.result.current.captions).toEqual([
    { id: 'agent-1', speaker: 'interviewer', text: 'Hello, welcome. Tell me about a project.' },
    { id: 'user-1', speaker: 'candidate', text: 'I worked on a lab system.' },
  ])
})

it('reads question progress and phase from the agent participant attributes', async () => {
  const { view, room } = await connectedRoom()
  expect(view.result.current.progress).toEqual({ questionPosition: null, questionTotal: null, phase: null })
  const agent = { isAgent: true, attributes: { 'cd.question_position': '0', 'cd.question_total': '5', 'cd.phase': 'asking' } }
  act(() => room.handlers.get('participantConnected')!(agent))
  expect(view.result.current.progress).toEqual({ questionPosition: 0, questionTotal: 5, phase: 'asking' })
  act(() => room.handlers.get('participantAttributesChanged')!({ 'cd.phase': 'answering' }, { ...agent, attributes: { ...agent.attributes, 'cd.phase': 'answering' } }))
  expect(view.result.current.progress.phase).toBe('answering')
  act(() => room.handlers.get('participantAttributesChanged')!({ 'cd.phase': 'x' }, { isAgent: false, attributes: { 'cd.phase': 'x' } }))
  expect(view.result.current.progress.phase).toBe('answering')
})

it('mutes and unmutes the microphone', async () => {
  const { view, room } = await connectedRoom()
  expect(view.result.current.muted).toBe(false)
  await act(() => view.result.current.mute(true))
  expect(room.setMicrophoneEnabled).toHaveBeenLastCalledWith(false)
  expect(view.result.current.muted).toBe(true)
  await act(() => view.result.current.mute(false))
  expect(room.setMicrophoneEnabled).toHaveBeenLastCalledWith(true)
  expect(view.result.current.muted).toBe(false)
})
