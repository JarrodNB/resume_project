/** Checks the live room adapter's wiring against a stand-in for the LiveKit SDK (no network). */
import { act, renderHook, waitFor } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing/react'
import type { MockLink } from '@apollo/client/testing'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { END_LIVE_INTERVIEW, JOIN_LIVE_INTERVIEW } from './interviewOperations'
import { useLiveInterviewRoom } from './useLiveInterviewRoom'

type TextHandler = (reader: AsyncIterable<string> & { info: { id: string; attributes?: Record<string, string> } }, participant: { identity: string }) => void
type FakeRoom = { handlers: Map<string, (...values: unknown[]) => void>; textHandlers: Map<string, TextHandler>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; setMicrophoneEnabled: ReturnType<typeof vi.fn>; performRpc: ReturnType<typeof vi.fn>; remoteParticipants: Map<string, unknown> }
const { rooms } = vi.hoisted(() => ({ rooms: [] as FakeRoom[] }))
vi.mock('livekit-client', () => {
  class Room {
    handlers = new Map<string, (...values: unknown[]) => void>()
    textHandlers = new Map<string, TextHandler>()
    connect = vi.fn().mockResolvedValue(undefined)
    disconnect = vi.fn().mockResolvedValue(undefined)
    setMicrophoneEnabled = vi.fn().mockResolvedValue(undefined)
    performRpc = vi.fn().mockResolvedValue('ended')
    remoteParticipants = new Map()
    localParticipant = { identity: 'user-owner', setMicrophoneEnabled: this.setMicrophoneEnabled, performRpc: this.performRpc }
    constructor() { rooms.push(this) }
    on(event: string, handler: (...values: unknown[]) => void) { this.handlers.set(event, handler); return this }
    registerTextStreamHandler(topic: string, handler: TextHandler) { this.textHandlers.set(topic, handler) }
  }
  return { Room, RoomEvent: { ParticipantConnected: 'participantConnected', ParticipantDisconnected: 'participantDisconnected', ParticipantAttributesChanged: 'participantAttributesChanged', TrackSubscribed: 'trackSubscribed', Disconnected: 'disconnected', Reconnecting: 'reconnecting', Reconnected: 'reconnected' }, Track: { Kind: { Audio: 'audio' } } }
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
function render(mock: MockLink.MockedResponse, ...more: MockLink.MockedResponse[]) {
  const wrapper = ({ children }: { children: ReactNode }) => <MockedProvider mocks={[mock, ...more]}>{children}</MockedProvider>
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

it('clears the joined interviewer and its progress when the agent participant leaves', async () => {
  const { view, room } = await connectedRoom()
  const agent = { isAgent: true, attributes: { 'cd.question_position': '1', 'cd.question_total': '5', 'cd.phase': 'menu', 'cd.menu_offered': 'true' } }
  act(() => room.handlers.get('participantConnected')!(agent))
  expect(view.result.current).toMatchObject({ agentJoined: true, agentLeft: false })
  act(() => room.handlers.get('participantDisconnected')!({ isAgent: false, attributes: {} }))
  expect(view.result.current.agentJoined).toBe(true)
  act(() => room.handlers.get('participantDisconnected')!(agent))
  expect(view.result.current).toMatchObject({ agentJoined: false, agentLeft: true })
  expect(view.result.current.progress).toEqual({ questionPosition: null, questionTotal: null, phase: null, menuOffered: false, secondsLeft: null, timeWarning: false })
  act(() => room.handlers.get('participantConnected')!(agent))
  expect(view.result.current).toMatchObject({ agentJoined: true, agentLeft: false })
})

it('fails with the Rails refusal without connecting', async () => {
  const view = render(joinMock({ errors: ['This interview is not a live interview'] }))
  await waitFor(() => expect(view.result.current).toMatchObject({ status: 'failed', error: 'This interview is not a live interview' }))
  expect(rooms.every((room) => !room.connect.mock.calls.length)).toBe(true)
})

async function connectedRoom(...more: MockLink.MockedResponse[]) {
  const view = render(joinMock({ url: 'wss://live.test', token: 'join-token', roomName: 'room', expiresAt: '2099-01-01T00:00:00Z' }), ...more)
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
  expect(view.result.current.progress).toEqual({ questionPosition: null, questionTotal: null, phase: null, menuOffered: false, secondsLeft: null, timeWarning: false })
  const agent = { isAgent: true, attributes: { 'cd.question_position': '0', 'cd.question_total': '5', 'cd.phase': 'asking', 'cd.menu_offered': 'false',
    'cd.seconds_left': '1500', 'cd.time_warning': 'false' } }
  act(() => room.handlers.get('participantConnected')!(agent))
  expect(view.result.current.progress).toEqual({ questionPosition: 0, questionTotal: 5, phase: 'asking', menuOffered: false, secondsLeft: 1500, timeWarning: false })
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

function endMock(errors: string[] = []) {
  const result = vi.fn(() => ({ data: { endLiveInterview: { __typename: 'EndLiveInterviewPayload', interview: null, errors, errorCode: null } } }))
  return { mock: { request: { query: END_LIVE_INTERVIEW, variables: { interviewId: 'session' } }, result } as MockLink.MockedResponse, result }
}
const agent = { identity: 'agent-1', isAgent: true, attributes: {} }

it('ends through the agent with the end option, then confirms the outcome with Rails', async () => {
  const end = endMock()
  const { view, room } = await connectedRoom(end.mock)
  room.remoteParticipants.set(agent.identity, agent)
  let ended = false
  await act(async () => { ended = await view.result.current.end() })
  expect(ended).toBe(true)
  expect(room.performRpc).toHaveBeenCalledWith(expect.objectContaining({ destinationIdentity: 'agent-1', method: 'interview.choose', payload: JSON.stringify({ option: 'end' }) }))
  expect(end.result).toHaveBeenCalledOnce()
  expect(view.result.current).toMatchObject({ ending: false, endError: null })
})

it('falls back to Rails when the agent refuses, does not answer within 5 seconds or is gone', async () => {
  const refused = endMock()
  const first = await connectedRoom(refused.mock)
  first.room.remoteParticipants.set(agent.identity, agent)
  first.room.performRpc.mockRejectedValue(new Error('Application error'))
  await act(async () => { await first.view.result.current.end() })
  expect(refused.result).toHaveBeenCalledOnce()
  first.view.unmount()

  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const slow = endMock()
    const second = await connectedRoom(slow.mock)
    second.room.remoteParticipants.set(agent.identity, agent)
    second.room.performRpc.mockReturnValue(new Promise(() => {}))
    let ending: Promise<boolean> = Promise.resolve(false)
    act(() => { ending = second.view.result.current.end() })
    expect(second.view.result.current.ending).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    await act(async () => { await ending })
    expect(slow.result).toHaveBeenCalledOnce()
    second.view.unmount()
  } finally { vi.useRealTimers() }

  const alone = endMock()
  const third = await connectedRoom(alone.mock)
  await act(async () => { await third.view.result.current.end() })
  expect(third.room.performRpc).not.toHaveBeenCalled()
  expect(alone.result).toHaveBeenCalledOnce()
})

it('reports a Rails refusal to end', async () => {
  const end = endMock(['Interview expired'])
  const { view } = await connectedRoom(end.mock)
  let ended = true
  await act(async () => { ended = await view.result.current.end() })
  expect(ended).toBe(false)
  expect(view.result.current).toMatchObject({ ending: false, endError: 'Interview expired' })
})

it('reads whether the agent offers the coaching menu', async () => {
  const { view, room } = await connectedRoom()
  act(() => room.handlers.get('participantConnected')!({ isAgent: true, attributes: { 'cd.phase': 'menu', 'cd.menu_offered': 'true' } }))
  expect(view.result.current.progress).toMatchObject({ phase: 'menu', menuOffered: true })
  act(() => room.handlers.get('participantAttributesChanged')!({}, { isAgent: true, attributes: { 'cd.phase': 'asking', 'cd.menu_offered': 'false' } }))
  expect(view.result.current.progress.menuOffered).toBe(false)
})

it('sends a menu choice to the agent and reports a failed choice', async () => {
  const { view, room } = await connectedRoom()
  room.remoteParticipants.set(agent.identity, agent)
  room.performRpc.mockResolvedValue('accepted')
  let sent = false
  await act(async () => { sent = await view.result.current.choose('retry') })
  expect(sent).toBe(true)
  expect(room.performRpc).toHaveBeenCalledWith(expect.objectContaining({ destinationIdentity: 'agent-1', method: 'interview.choose', payload: JSON.stringify({ option: 'retry' }) }))
  expect(view.result.current).toMatchObject({ choosing: false, chooseError: null })

  room.performRpc.mockRejectedValue(new Error('Application error'))
  await act(async () => { sent = await view.result.current.choose('hint') })
  expect(sent).toBe(false)
  expect(view.result.current).toMatchObject({ choosing: false, chooseError: 'Your interviewer didn’t get that choice. Try again or say it out loud.' })
  room.performRpc.mockResolvedValue('accepted')
  await act(async () => { await view.result.current.choose('next') })
  expect(view.result.current.chooseError).toBeNull()
})

it('reports a choice made while the interviewer is not in the room', async () => {
  const { view } = await connectedRoom()
  await act(async () => { await view.result.current.choose('feedback') })
  expect(view.result.current.chooseError).toMatch(/didn’t get that choice/)
})

it('reads the counted time left and the time warning from the agent', async () => {
  const { view, room } = await connectedRoom()
  act(() => room.handlers.get('participantConnected')!({ isAgent: true, attributes: { 'cd.seconds_left': '118', 'cd.time_warning': 'true' } }))
  expect(view.result.current.progress).toMatchObject({ secondsLeft: 118, timeWarning: true })
  act(() => room.handlers.get('participantAttributesChanged')!({}, { isAgent: true, attributes: { 'cd.seconds_left': 'soon' } }))
  expect(view.result.current.progress).toMatchObject({ secondsLeft: null, timeWarning: false })
})

it('shows reconnecting while LiveKit retries and connected again once it is back', async () => {
  const { view, room } = await connectedRoom()
  act(() => room.handlers.get('reconnecting')!())
  expect(view.result.current.status).toBe('reconnecting')
  act(() => room.handlers.get('reconnected')!())
  expect(view.result.current.status).toBe('connected')
})

it('rejoins the same room through Rails after the connection dropped', async () => {
  const rejoin = joinMock({ url: 'wss://live.test', token: 'fresh-token', roomName: 'room', expiresAt: '2099-01-01T00:00:00Z' })
  const { view, room } = await connectedRoom(rejoin)
  act(() => room.handlers.get('participantConnected')!({ isAgent: true, attributes: {} }))
  act(() => room.handlers.get('disconnected')!())
  expect(view.result.current).toMatchObject({ status: 'disconnected', agentJoined: false })
  await act(async () => { await view.result.current.rejoin() })
  await waitFor(() => expect(view.result.current.status).toBe('connected'))
  expect(room.connect).toHaveBeenLastCalledWith('wss://live.test', 'fresh-token')
  expect(room.setMicrophoneEnabled).toHaveBeenLastCalledWith(true)
})

it('stays disconnected with the reason when Rails refuses the rejoin', async () => {
  const { view, room } = await connectedRoom(joinMock({ errors: ['Interview has ended'] }))
  act(() => room.handlers.get('disconnected')!())
  await act(async () => { await view.result.current.rejoin() })
  expect(view.result.current).toMatchObject({ status: 'disconnected', error: 'Interview has ended' })
})

it('ends the live room as failed through Rails, without the agent, when the candidate switches to turn-based', async () => {
  const result = vi.fn(() => ({ data: { endLiveInterview: { __typename: 'EndLiveInterviewPayload', interview: null, errors: [], errorCode: null } } }))
  const { view, room } = await connectedRoom({ request: { query: END_LIVE_INTERVIEW, variables: { interviewId: 'session', liveUnavailable: true } }, result })
  room.remoteParticipants.set(agent.identity, agent)
  await act(async () => { await view.result.current.leaveForTurnBased() })
  expect(result).toHaveBeenCalledOnce()
  expect(room.performRpc).not.toHaveBeenCalled()
})

// docs/architecture/interview-sessions.md ("Room contract") lists these literals; the agent's test
// (services/ai/tests/test_live_interview_agent.py) checks the same ones.
it('reads the documented cd.* attributes and sends each documented interview.choose option', async () => {
  const { view, room } = await connectedRoom()
  act(() => room.handlers.get('participantConnected')!({ ...agent, attributes: { 'cd.question_position': '2', 'cd.question_total': '6', 'cd.phase': 'menu',
    'cd.menu_offered': 'true', 'cd.seconds_left': '90', 'cd.time_warning': 'true' } }))
  expect(view.result.current.progress).toEqual({ questionPosition: 2, questionTotal: 6, phase: 'menu', menuOffered: true, secondsLeft: 90, timeWarning: true })
  room.remoteParticipants.set(agent.identity, agent)
  for (const option of ['retry', 'repeat', 'hint', 'next', 'feedback'] as const) {
    await act(async () => { await view.result.current.choose(option) })
    expect(room.performRpc).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'interview.choose', payload: JSON.stringify({ option }) }))
  }
})
