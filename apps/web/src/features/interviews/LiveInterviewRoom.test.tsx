/** Verifies live sessions open the live room, its connection states, captions, progress, mute,
 * the coaching menu and "How was that?", End interview, the career references panel, the
 * turn-based fallback and the completed review of a live session (with the interviewer's saved
 * feedback), against a fake live room hook (no LiveKit). */
import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { InterviewPage } from './InterviewPage'

const { state, start, startFrom, live } = vi.hoisted(() => ({
  state: { interview: null as unknown, loading: false, loadError: null, subscriptionError: null, busy: false, error: null, errorCode: null, unresolved: null, skipPending: false,
    transcribeRecording: vi.fn(), cancelTranscription: vi.fn(), answer: vi.fn(), answerText: vi.fn(), checkSavedStatus: vi.fn(), retryOperation: vi.fn(), beginInterview: vi.fn(), abandonInterview: vi.fn(), skipQuestion: vi.fn() },
  start: vi.fn(),
  startFrom: vi.fn(),
  live: { hook: vi.fn(), value: {} as Record<string, unknown> },
}))
const NO_PROGRESS = { questionPosition: null, questionTotal: null, phase: null, stateSeq: null, menuOffered: false, secondsLeft: null, timeWarning: false }
function liveRoom(change: Record<string, unknown> = {}) {
  return { status: 'joining', roomOpened: true, agentJoined: false, agentLeft: false, error: null, captions: [], progress: NO_PROGRESS, muted: false, ending: false, endError: null,
    choosing: false, chooseError: null, mute: vi.fn().mockResolvedValue(undefined), choose: vi.fn().mockResolvedValue(true), end: vi.fn().mockResolvedValue(true),
    rejoin: vi.fn().mockResolvedValue(undefined), leaveForTurnBased: vi.fn().mockResolvedValue(undefined), ...change }
}
vi.mock('./useInterviewSession', () => ({ useInterviewSession: () => state, useStartInterview: () => ({ start, startFrom, loading: false, error: null }) }))
vi.mock('./useLiveInterviewRoom', () => ({ useLiveInterviewRoom: (id: string) => { live.hook(id); return live.value } }))
vi.mock('./RecentInterviews', () => ({ RecentInterviews: () => null }))
vi.mock('./InterviewCareerReferences', () => ({ InterviewCareerReferences: ({ message, disabled }: { message: { id: string; content: string }; disabled: boolean }) =>
  <section aria-label="Relevant career examples" data-message={message.id} data-disabled={String(disabled)}>{message.content}</section> }))
vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }))

const setup = { __typename: 'InterviewSetup', questionCount: 5, questionFormat: 'behavioral', difficulty: 'stretch', interviewer: 'maya', focusAreas: ['leadership'] }
const snapshot = {
  __typename: 'InterviewSession', id: 'session', status: 'active', interviewType: 'basic', conversationMode: 'LIVE', executionMode: 'real', speechPlaybackMode: 'browser',
  preparedRole: { title: 'Laboratory technician', responsibilities: [], requirements: [] }, revision: 1, answerCap: 3, currentQuestionPosition: 0, expiresAt: '2099-10-27',
  feedback: null, setup, jobContext: null, questions: [{ id: 'question', content: 'Describe a project.', questionType: 'behavioral', position: 0, acceptedAnswerCount: 0, skipped: false, liveFeedback: null }], messages: [], operations: [],
}

function renderInterview() {
  return renderPage({ path: '/practice/interviews/:id?', url: '/practice/interviews/session', element: <InterviewPage />, mocks: [] })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.interview = structuredClone(snapshot)
  live.value = liveRoom()
  start.mockResolvedValue('turn-based-session')
  startFrom.mockResolvedValue('turn-based-session')
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
  expect(startFrom).toHaveBeenCalledWith('session', 'TURN_BASED') // Rails copies the setup, job and career focus
  expect(start).not.toHaveBeenCalled()
  expect(live.value.leaveForTurnBased).toHaveBeenCalledOnce() // the abandoned live room never stays active
})

it('keeps the live room when the turn-based interview could not start', async () => {
  startFrom.mockResolvedValue(null)
  live.value = liveRoom({ status: 'failed', error: 'Live interviews are not configured.' })
  renderInterview()
  fireEvent.click(screen.getByRole('button', { name: 'Start a turn-based interview with the same setup' }))
  await vi.waitFor(() => expect(startFrom).toHaveBeenCalled())
  expect(live.value.leaveForTurnBased).not.toHaveBeenCalled()
})

it('shows reconnecting while the connection recovers, with the room controls still in place', () => {
  live.value = liveRoom({ status: 'reconnecting', agentJoined: true })
  renderInterview()
  expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…')
  expect(screen.queryByRole('button', { name: 'Rejoin interview' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Start a turn-based interview with the same setup' })).not.toBeInTheDocument()
})

it('offers to rejoin the same interview after the connection dropped', () => {
  live.value = liveRoom({ status: 'disconnected', error: 'Interview service is busy.' })
  renderInterview()
  expect(screen.getByRole('status')).toHaveTextContent('You were disconnected. Your interviewer waits about 2 minutes.')
  expect(screen.getByRole('alert')).toHaveTextContent('Interview service is busy.')
  expect(screen.queryByRole('button', { name: 'Start a turn-based interview with the same setup' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Rejoin interview' }))
  expect(live.value.rejoin).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: 'End interview' })).toBeVisible()
})

it('offers the fallback at once when joining fails, starting from this session', async () => {
  live.value = liveRoom({ status: 'failed', error: 'Live interviews are not configured.' })
  renderInterview()
  expect(screen.getByRole('alert')).toHaveTextContent('Live interviews are not configured.')
  fireEvent.click(screen.getByRole('button', { name: 'Start a turn-based interview with the same setup' }))
  await vi.waitFor(() => expect(startFrom).toHaveBeenCalledWith('session', 'TURN_BASED'))
})

it('says the interviewer left and offers the fallback again if no interviewer returns within 15 seconds', () => {
  vi.useFakeTimers()
  live.value = liveRoom({ status: 'connected', agentJoined: false, agentLeft: true })
  renderInterview()
  expect(screen.getByRole('status')).toHaveTextContent('Your interviewer left the room. Waiting for them to come back…')
  expect(screen.queryByRole('button', { name: 'Start a turn-based interview with the same setup' })).not.toBeInTheDocument()
  act(() => { vi.advanceTimersByTime(15_000) })
  expect(screen.getByRole('button', { name: 'Start a turn-based interview with the same setup' })).toBeVisible()
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
  live.value = liveRoom({ status: 'connected', agentJoined: true, progress: { ...NO_PROGRESS, questionPosition: 0, questionTotal: 5, phase: 'answering' } })
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

it('hides End interview when Rails never opened a room, leaving only the turn-based fallback', () => {
  live.value = liveRoom({ status: 'failed', roomOpened: false, error: 'You need at least 5 live minutes.' })
  renderInterview()
  expect(screen.getByRole('button', { name: 'Start a turn-based interview with the same setup' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'End interview' })).not.toBeInTheDocument()
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

const MENU_BUTTONS = ['Try again', 'Hear the question again', 'Get a hint', 'Move on']
const menuProgress = { questionPosition: 0, questionTotal: 5, phase: 'menu', menuOffered: true }

it('shows the four coaching choices only while the interviewer offers the menu', () => {
  live.value = liveRoom({ status: 'connected', agentJoined: true, progress: { ...menuProgress, phase: 'answering', menuOffered: false } })
  const view = renderInterview()
  expect(screen.queryByRole('group', { name: 'What would you like to do next?' })).not.toBeInTheDocument()
  MENU_BUTTONS.forEach((name) => expect(screen.queryByRole('button', { name })).not.toBeInTheDocument())
  view.unmount()
  live.value = liveRoom({ status: 'connected', agentJoined: true, progress: menuProgress })
  renderInterview()
  const group = screen.getByRole('group', { name: 'What would you like to do next?' })
  expect([...group.querySelectorAll('button')].map((button) => button.textContent)).toEqual(MENU_BUTTONS)
})

it.each([['Try again', 'retry'], ['Hear the question again', 'repeat'], ['Get a hint', 'hint'], ['Move on', 'next']] as const)(
  'sends %s to the interviewer', (name, option) => {
    live.value = liveRoom({ status: 'connected', agentJoined: true, progress: menuProgress })
    renderInterview()
    fireEvent.click(screen.getByRole('button', { name }))
    expect(live.value.choose).toHaveBeenCalledWith(option)
  })

it('disables the choices while one is being sent and shows a failed choice', () => {
  live.value = liveRoom({ status: 'connected', agentJoined: true, progress: menuProgress, choosing: true })
  const view = renderInterview()
  MENU_BUTTONS.forEach((name) => expect(screen.getByRole('button', { name })).toBeDisabled())
  view.unmount()
  live.value = liveRoom({ status: 'connected', agentJoined: true, progress: menuProgress, chooseError: 'Your interviewer didn’t get that choice. Try again or say it out loud.' })
  renderInterview()
  expect(screen.getByRole('alert')).toHaveTextContent('didn’t get that choice')
  MENU_BUTTONS.forEach((name) => expect(screen.getByRole('button', { name })).toBeEnabled())
})

it('offers "How was that?" while the candidate is answering', () => {
  live.value = liveRoom({ status: 'connected', agentJoined: true, progress: { ...menuProgress, phase: 'asking', menuOffered: false } })
  const view = renderInterview()
  expect(screen.queryByRole('button', { name: 'How was that?' })).not.toBeInTheDocument()
  view.unmount()
  live.value = liveRoom({ status: 'connected', agentJoined: true, progress: { ...menuProgress, phase: 'answering', menuOffered: false } })
  renderInterview()
  fireEvent.click(screen.getByRole('button', { name: 'How was that?' }))
  expect(live.value.choose).toHaveBeenCalledWith('feedback')
})

it('shows the interviewer\'s saved feedback under the question\'s latest answer in the completed review', () => {
  state.interview = { ...structuredClone(snapshot), status: 'completed', messages: [
    opening,
    { ...opening, id: 'answer-1', kind: 'answer', position: 1, content: 'I rebuilt our lab scheduler.' },
  ], questions: [
    { ...snapshot.questions[0], acceptedAnswerCount: 1, liveFeedback: 'Quick feedback: clear example. Lead with the result.' },
    { ...snapshot.questions[0], id: 'question-2', position: 1, content: 'Second question?', liveFeedback: null },
  ] }
  renderInterview()
  fireEvent.click(screen.getByRole('button', { name: /Core question 1/ }))
  fireEvent.click(screen.getByRole('button', { name: /Core question 2/ }))
  const saved = screen.getByLabelText('Saved questions and answers')
  const feedback = screen.getAllByRole('region', { name: 'Interviewer feedback' })
  expect(feedback).toHaveLength(1)
  expect(feedback[0]).toHaveTextContent('Quick feedback: clear example. Lead with the result.')
  expect(saved.textContent!.indexOf('I rebuilt our lab scheduler.')).toBeLessThan(saved.textContent!.indexOf('Interviewer feedback'))
})

it('shows the counted time left as minutes and seconds, and nothing before the agent publishes it', () => {
  live.value = liveRoom({ status: 'connected', agentJoined: true })
  const view = renderInterview()
  expect(screen.queryByText(/left$/)).not.toBeInTheDocument()
  view.unmount()
  live.value = liveRoom({ status: 'connected', agentJoined: true, progress: { ...NO_PROGRESS, secondsLeft: 1495 } })
  renderInterview()
  expect(screen.getByText('24:55 left')).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('shows and announces the two-minute warning', () => {
  live.value = liveRoom({ status: 'connected', agentJoined: true, progress: { ...NO_PROGRESS, secondsLeft: 65, timeWarning: true } })
  renderInterview()
  expect(screen.getByText('1:05 left')).toBeVisible()
  expect(screen.getByRole('alert')).toHaveTextContent('About 2 minutes left. Start wrapping up.')
})
