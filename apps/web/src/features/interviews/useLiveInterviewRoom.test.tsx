/** Checks the live room adapter's wiring against a stand-in for the LiveKit SDK (no network). */
import { act, renderHook, waitFor } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing/react'
import type { MockLink } from '@apollo/client/testing'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { JOIN_LIVE_INTERVIEW } from './interviewOperations'
import { useLiveInterviewRoom } from './useLiveInterviewRoom'

const { rooms } = vi.hoisted(() => ({ rooms: [] as Array<{ handlers: Map<string, (value: unknown) => void>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; setMicrophoneEnabled: ReturnType<typeof vi.fn> }> }))
vi.mock('livekit-client', () => {
  class Room {
    handlers = new Map<string, (value: unknown) => void>()
    connect = vi.fn().mockResolvedValue(undefined)
    disconnect = vi.fn().mockResolvedValue(undefined)
    setMicrophoneEnabled = vi.fn().mockResolvedValue(undefined)
    remoteParticipants = new Map()
    localParticipant = { setMicrophoneEnabled: this.setMicrophoneEnabled }
    constructor() { rooms.push(this) }
    on(event: string, handler: (value: unknown) => void) { this.handlers.set(event, handler); return this }
  }
  return { Room, RoomEvent: { ParticipantConnected: 'participantConnected', TrackSubscribed: 'trackSubscribed', Disconnected: 'disconnected' }, Track: { Kind: { Audio: 'audio' } } }
})

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
  act(() => room.handlers.get('participantConnected')!({ isAgent: false }))
  expect(view.result.current.agentJoined).toBe(false)
  act(() => room.handlers.get('participantConnected')!({ isAgent: true }))
  expect(view.result.current.agentJoined).toBe(true)
  view.unmount()
  expect(room.disconnect).toHaveBeenCalled()
})

it('fails with the Rails refusal without connecting', async () => {
  const view = render(joinMock({ errors: ['This interview is not a live interview'] }))
  await waitFor(() => expect(view.result.current).toMatchObject({ status: 'failed', error: 'This interview is not a live interview' }))
  expect(rooms.every((room) => !room.connect.mock.calls.length)).toBe(true)
})
