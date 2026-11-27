/** Verifies live sessions open the live room, its connection states and the turn-based fallback,
 * against a fake live room hook (no LiveKit). */
import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { InterviewPage } from './InterviewPage'

const { state, start, live } = vi.hoisted(() => ({
  state: { interview: null as unknown, loading: false, loadError: null, subscriptionError: null, busy: false, error: null, errorCode: null, unresolved: null, skipPending: false,
    transcribeRecording: vi.fn(), cancelTranscription: vi.fn(), answer: vi.fn(), answerText: vi.fn(), checkSavedStatus: vi.fn(), retryOperation: vi.fn(), beginInterview: vi.fn(), abandonInterview: vi.fn(), skipQuestion: vi.fn() },
  start: vi.fn(),
  live: { hook: vi.fn(), value: { status: 'joining', agentJoined: false, error: null as string | null } },
}))
vi.mock('./useInterviewSession', () => ({ useInterviewSession: () => state, useStartInterview: () => ({ start, loading: false, error: null }) }))
vi.mock('./useLiveInterviewRoom', () => ({ useLiveInterviewRoom: (id: string) => { live.hook(id); return live.value } }))
vi.mock('./RecentInterviews', () => ({ RecentInterviews: () => null }))
vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }))

const setup = { __typename: 'InterviewSetup', questionCount: 5, questionFormat: 'behavioral', difficulty: 'stretch', interviewer: 'maya', focusAreas: ['leadership'] }
const snapshot = {
  __typename: 'InterviewSession', id: 'session', status: 'active', interviewType: 'basic', conversationMode: 'live', executionMode: 'real', speechPlaybackMode: 'browser',
  preparedRole: { title: 'Laboratory technician', responsibilities: [], requirements: [] }, revision: 1, answerCap: 3, currentQuestionPosition: 0, expiresAt: '2099-10-27',
  feedback: null, setup, jobContext: null, questions: [{ id: 'question', content: 'Describe a project.', questionType: 'behavioral', position: 0, acceptedAnswerCount: 0, skipped: false }], messages: [], operations: [],
}

function renderInterview() {
  return renderPage({ path: '/practice/interviews/:id?', url: '/practice/interviews/session', element: <InterviewPage />, mocks: [] })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.interview = structuredClone(snapshot)
  live.value = { status: 'joining', agentJoined: false, error: null }
  start.mockResolvedValue('turn-based-session')
})
afterEach(() => { vi.useRealTimers() })

it('renders the live room for an active live session instead of the turn-based room', () => {
  renderInterview()
  expect(live.hook).toHaveBeenCalledWith('session')
  expect(screen.getByRole('heading', { name: 'Live interview' })).toBeVisible()
  expect(screen.getByRole('status')).toHaveTextContent('Joining the interview room…')
  expect(screen.queryByRole('region', { name: 'Current interview turn' })).not.toBeInTheDocument()
})

it('enters a ready live session through the live room, never the turn-based begin', () => {
  state.interview = { ...structuredClone(snapshot), status: 'ready', revision: 0 }
  renderInterview()
  expect(live.hook).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Enter interview room' }))
  expect(state.beginInterview).not.toHaveBeenCalled()
  expect(live.hook).toHaveBeenCalledWith('session')
  expect(screen.getByRole('heading', { name: 'Live interview' })).toBeVisible()
})

it.each([
  ['connecting', false, 'Connecting…'],
  ['connected', false, 'Waiting for your interviewer…'],
  ['connected', true, 'Connected. Your interviewer is here.'],
] as const)('shows the %s state (interviewer joined: %s)', (status, agentJoined, text) => {
  live.value = { status, agentJoined, error: null }
  renderInterview()
  expect(screen.getByRole('status')).toHaveTextContent(text)
})

it('offers a turn-based interview with the same setup when no interviewer joins within 15 seconds', async () => {
  vi.useFakeTimers()
  live.value = { status: 'connected', agentJoined: false, error: null }
  const { router } = renderInterview()
  act(() => { vi.advanceTimersByTime(14_000) })
  expect(screen.queryByRole('button', { name: 'Start a turn-based interview with the same setup' })).not.toBeInTheDocument()
  act(() => { vi.advanceTimersByTime(1_000) })
  expect(screen.getByRole('alert')).toHaveTextContent('Your live interviewer didn’t join')
  vi.useRealTimers()
  fireEvent.click(screen.getByRole('button', { name: 'Start a turn-based interview with the same setup' }))
  await vi.waitFor(() => expect(router.state.location.pathname).toBe('/practice/interviews/turn-based-session'))
  expect(start).toHaveBeenCalledWith('', { questionCount: 5, questionFormat: 'behavioral', difficulty: 'stretch', interviewer: 'maya', focusAreas: ['leadership'] }, undefined, 'turn_based')
})

it('offers the fallback at once when joining fails, keeping a saved job', async () => {
  state.interview = { ...structuredClone(snapshot), jobContext: { __typename: 'InterviewJobContext', id: 'job-1', title: 'Technician', company: null, description: null, requirements: [], responsibilities: [], niceToHaves: [] } }
  live.value = { status: 'failed', agentJoined: false, error: 'Live interviews are not configured.' }
  renderInterview()
  expect(screen.getByRole('alert')).toHaveTextContent('Live interviews are not configured.')
  fireEvent.click(screen.getByRole('button', { name: 'Start a turn-based interview with the same setup' }))
  await vi.waitFor(() => expect(start).toHaveBeenCalledWith('', expect.objectContaining({ questionCount: 5 }), 'job-1', 'turn_based'))
})

it('does not offer the fallback once the interviewer has joined', () => {
  vi.useFakeTimers()
  live.value = { status: 'connected', agentJoined: true, error: null }
  renderInterview()
  act(() => { vi.advanceTimersByTime(20_000) })
  expect(screen.queryByRole('button', { name: 'Start a turn-based interview with the same setup' })).not.toBeInTheDocument()
})
