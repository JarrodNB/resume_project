/** Verifies live sessions open the live room, its connection states, captions, progress, mute,
 * End interview, the career references panel, the turn-based fallback and the completed review
 * of a live session, against a fake live room hook (no LiveKit). */
import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { InterviewPage } from './InterviewPage'

const { state, start, live } = vi.hoisted(() => ({
  state: { interview: null as unknown, loading: false, loadError: null, subscriptionError: null, busy: false, error: null, errorCode: null, unresolved: null, skipPending: false,
    transcribeRecording: vi.fn(), cancelTranscription: vi.fn(), answer: vi.fn(), answerText: vi.fn(), checkSavedStatus: vi.fn(), retryOperation: vi.fn(), beginInterview: vi.fn(), abandonInterview: vi.fn(), skipQuestion: vi.fn() },
  start: vi.fn(),
  live: { hook: vi.fn(), value: {} as Record<string, unknown> },
}))
const NO_PROGRESS = { questionPosition: null, questionTotal: null, phase: null }
function liveRoom(change: Record<string, unknown> = {}) {
  return { status: 'joining', agentJoined: false, error: null, captions: [], progress: NO_PROGRESS, muted: false, ending: false, endError: null,
    mute: vi.fn().mockResolvedValue(undefined), end: vi.fn().mockResolvedValue(true), ...change }
}
vi.mock('./useInterviewSession', () => ({ useInterviewSession: () => state, useStartInterview: () => ({ start, loading: false, error: null }) }))
vi.mock('./useLiveInterviewRoom', () => ({ useLiveInterviewRoom: (id: string) => { live.hook(id); return live.value } }))
vi.mock('./RecentInterviews', () => ({ RecentInterviews: () => null }))
vi.mock('./InterviewCareerReferences', () => ({ InterviewCareerReferences: ({ message, disabled }: { message: { id: string; content: string }; disabled: boolean }) =>
  <section aria-label="Relevant career examples" data-message={message.id} data-disabled={String(disabled)}>{message.content}</section> }))
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
  live.value = liveRoom()
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
  live.value = liveRoom({ status, agentJoined })
  renderInterview()
  expect(screen.getByRole('status')).toHaveTextContent(text)
})

it('offers a turn-based interview with the same setup when no interviewer joins within 15 seconds', async () => {
  vi.useFakeTimers()
  live.value = liveRoom({ status: 'connected' })
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
  live.value = liveRoom({ status: 'failed', error: 'Live interviews are not configured.' })
  renderInterview()
  expect(screen.getByRole('alert')).toHaveTextContent('Live interviews are not configured.')
  fireEvent.click(screen.getByRole('button', { name: 'Start a turn-based interview with the same setup' }))
  await vi.waitFor(() => expect(start).toHaveBeenCalledWith('', expect.objectContaining({ questionCount: 5 }), 'job-1', 'turn_based'))
})

it('does not offer the fallback once the interviewer has joined', () => {
  vi.useFakeTimers()
  live.value = liveRoom({ status: 'connected', agentJoined: true })
  renderInterview()
  act(() => { vi.advanceTimersByTime(20_000) })
  expect(screen.queryByRole('button', { name: 'Start a turn-based interview with the same setup' })).not.toBeInTheDocument()
})

const opening = { __typename: 'InterviewSessionMessage', id: 'opening', questionId: 'question', kind: 'opening', position: 0, content: 'Hi there. Describe a project you are proud of.',
  acknowledgement: null, avoided: false, careerReferences: null, clarification: null }

it('shows both sides\' captions and lets the candidate hide and show them', () => {
  live.value = liveRoom({ status: 'connected', agentJoined: true, captions: [
    { id: 'a1', speaker: 'interviewer', text: 'Describe a project you are proud of.' },
    { id: 'u1', speaker: 'candidate', text: 'I rebuilt our lab scheduler.' },
  ] })
  renderInterview()
  const captions = screen.getByRole('log', { name: 'Captions' })
  expect(captions).toHaveTextContent('Interviewer: Describe a project you are proud of.')
  expect(captions).toHaveTextContent('You: I rebuilt our lab scheduler.')
  fireEvent.click(screen.getByRole('button', { name: 'Hide captions' }))
  expect(screen.queryByRole('log', { name: 'Captions' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Show captions' }))
  expect(screen.getByRole('log', { name: 'Captions' })).toHaveTextContent('I rebuilt our lab scheduler.')
})

it('shows question progress from the agent and nothing before the agent publishes it', () => {
  live.value = liveRoom({ status: 'connected', agentJoined: true })
  const view = renderInterview()
  expect(screen.queryByText(/Question \d+ of/)).not.toBeInTheDocument()
  view.unmount()
  live.value = liveRoom({ status: 'connected', agentJoined: true, progress: { questionPosition: 0, questionTotal: 5, phase: 'answering' } })
  renderInterview()
  expect(screen.getByText('Question 1 of 5')).toBeVisible()
})

it('mutes and unmutes the microphone with a toggle button', () => {
  live.value = liveRoom({ status: 'connected', agentJoined: true })
  const view = renderInterview()
  const mute = screen.getByRole('button', { name: 'Mute microphone' })
  expect(mute).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(mute)
  expect(live.value.mute).toHaveBeenCalledWith(true)
  view.unmount()
  live.value = liveRoom({ status: 'connected', agentJoined: true, muted: true })
  renderInterview()
  const muted = screen.getByRole('button', { name: 'Mute microphone' })
  expect(muted).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(muted)
  expect(live.value.mute).toHaveBeenCalledWith(false)
})

it('shows the career references panel for the saved opening of the current question', () => {
  live.value = liveRoom({ status: 'connected', agentJoined: true })
  const view = renderInterview()
  expect(screen.queryByRole('region', { name: 'Relevant career examples' })).not.toBeInTheDocument()
  view.unmount()
  state.interview = { ...structuredClone(snapshot), messages: [opening] }
  renderInterview()
  const panel = screen.getByRole('region', { name: 'Relevant career examples' })
  expect(panel).toHaveAttribute('data-message', 'opening')
  expect(panel).toHaveAttribute('data-disabled', 'false')
})

it('asks for confirmation before ending the interview, and can be kept', async () => {
  live.value = liveRoom({ status: 'connected', agentJoined: true })
  renderInterview()
  fireEvent.click(screen.getByRole('button', { name: 'End interview' }))
  const dialog = screen.getByRole('dialog', { name: 'End this interview?' })
  expect(dialog).toHaveTextContent('Your saved answers stay')
  fireEvent.click(screen.getByRole('button', { name: 'Keep interview' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(live.value.end).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'End interview' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm end' }))
  await vi.waitFor(() => expect(live.value.end).toHaveBeenCalledOnce())
})

it('shows ending progress and a refusal to end', () => {
  live.value = liveRoom({ status: 'connected', agentJoined: true, ending: true })
  const view = renderInterview()
  expect(screen.getByRole('button', { name: 'Ending…' })).toBeDisabled()
  view.unmount()
  live.value = liveRoom({ status: 'connected', agentJoined: true, endError: 'Interview expired' })
  renderInterview()
  expect(screen.getByRole('alert')).toHaveTextContent('Interview expired')
})

it('offers End interview even while the interviewer has not joined', () => {
  live.value = liveRoom({ status: 'connected' })
  renderInterview()
  expect(screen.getByRole('button', { name: 'End interview' })).toBeEnabled()
})

it('shows the completed review of a live session with its questions, latest answers and follow-ups', () => {
  state.interview = { ...structuredClone(snapshot), status: 'completed', messages: [
    opening,
    { ...opening, id: 'answer-1', kind: 'answer', position: 1, content: 'I rebuilt our lab scheduler.' },
    { ...opening, id: 'follow-1', kind: 'follow_up', position: 2, content: 'What changed for the team?' },
    { ...opening, id: 'answer-2', kind: 'answer', position: 3, content: 'Fewer failed runs.' },
  ], questions: [{ ...snapshot.questions[0], acceptedAnswerCount: 2 }] }
  renderInterview()
  expect(live.hook).not.toHaveBeenCalled()
  expect(screen.getByRole('heading', { name: 'Interview complete' })).toBeVisible()
  expect(screen.getByText('1 answered · 0 skipped without an answer · Remaining follow-ups skipped on 0 questions')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /Core question 1/ }))
  const saved = screen.getByLabelText('Saved questions and answers')
  expect(saved).toHaveTextContent('I rebuilt our lab scheduler.')
  expect(saved).toHaveTextContent('Follow-upWhat changed for the team?')
  expect(saved).toHaveTextContent('Fewer failed runs.')
  fireEvent.click(screen.getByRole('button', { name: 'Interview feedback' }))
  expect(screen.getByRole('button', { name: 'Generate feedback' })).toBeEnabled()
})
