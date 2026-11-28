/** Verifies the Turn-based / Live choice in the round step for practice-role and saved-job setup. */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { InterviewSetup } from './InterviewSetup'
import { LIVE_INTERVIEW_ALLOWANCE } from './interviewOperations'

const { start } = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock('./useInterviewSession', () => ({ useStartInterview: () => ({ start, loading: false, error: null }) }))
vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }))
const job = { id: 'job-1', title: 'Laboratory technician', company: 'Sample Labs', description: null,
  requirements: [], responsibilities: [], niceToHaves: [] }

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); start.mockResolvedValue('session') })

function startFromSettings() {
  fireEvent.click(screen.getByRole('button', { name: 'Continue to settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Start interview' }))
}

it('offers Turn-based by default and sends it with a practice-role start', () => {
  renderPage({ path: '/practice/interviews', url: '/practice/interviews', element: <InterviewSetup />, mocks: [] })
  expect(screen.getByRole('radio', { name: 'Turn-based' })).toBeChecked()
  expect(screen.getByRole('radio', { name: /Full loop/ })).toBeInTheDocument()
  startFromSettings()
  expect(start).toHaveBeenCalledWith('', expect.objectContaining({ questionCount: 8 }), undefined, 'TURN_BASED')
})

it('hides the twelve-question length for Live and moves a full loop to eight questions', () => {
  renderPage({ path: '/practice/interviews', url: '/practice/interviews', element: <InterviewSetup />, mocks: [] })
  fireEvent.click(screen.getByRole('radio', { name: /Full loop/ }))
  fireEvent.click(screen.getByRole('radio', { name: 'Live' }))
  expect(screen.queryByRole('radio', { name: /Full loop/ })).not.toBeInTheDocument()
  expect(screen.getByRole('radio', { name: /Standard/ })).toBeChecked()
  startFromSettings()
  expect(start).toHaveBeenCalledWith('', expect.objectContaining({ questionCount: 8 }), undefined, 'LIVE')
})

it('sends a Live choice with a saved-job start', () => {
  renderPage({ path: '/jobs/:jobId/interview', url: '/jobs/job-1/interview', element: <InterviewSetup job={job} />, mocks: [] })
  fireEvent.click(screen.getByRole('radio', { name: 'Live' }))
  fireEvent.click(screen.getByRole('radio', { name: /Short/ }))
  startFromSettings()
  expect(start).toHaveBeenCalledWith('', expect.objectContaining({ questionCount: 5 }), 'job-1', 'LIVE')
})

const LIMIT_REACHED = "You've reached today's live interview limit. Try again tomorrow, or start a turn-based interview."

function allowance(refusal: string | null) {
  return { request: { query: LIVE_INTERVIEW_ALLOWANCE }, result: { data: { me: { __typename: 'User', id: 'owner', liveInterviewRefusal: refusal } } } }
}

it('shows nothing about the live limit until it is reached', async () => {
  renderPage({ path: '/practice/interviews', url: '/practice/interviews', element: <InterviewSetup />, mocks: [allowance(null)] })
  fireEvent.click(screen.getByRole('radio', { name: 'Live' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Continue to settings' })).toBeEnabled())
  expect(screen.queryByText(/minute|limit/i)).not.toBeInTheDocument()
})

it('disables starting a Live interview with the reason once the live limit is reached', async () => {
  renderPage({ path: '/practice/interviews', url: '/practice/interviews', element: <InterviewSetup />, mocks: [allowance(LIMIT_REACHED)] })
  fireEvent.click(screen.getByRole('radio', { name: 'Live' }))
  const reason = await screen.findByText(LIMIT_REACHED)
  const next = screen.getByRole('button', { name: 'Continue to settings' })
  expect(next).toBeDisabled()
  expect(next).toHaveAccessibleDescription(reason.textContent!)
  fireEvent.click(screen.getByRole('radio', { name: 'Turn-based' }))
  expect(screen.getByRole('button', { name: 'Continue to settings' })).toBeEnabled()
  startFromSettings()
  expect(start).toHaveBeenCalledWith('', expect.anything(), undefined, 'TURN_BASED')
})

it('shows only the silence length in Live settings and remembers the choice for the live room', () => {
  renderPage({ path: '/practice/interviews', url: '/practice/interviews', element: <InterviewSetup />, mocks: [] })
  fireEvent.click(screen.getByRole('radio', { name: 'Live' }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue to settings' }))
  for (const name of ['Automatic', 'Tap to start', '3 sec', 'Streaming']) expect(screen.queryByRole('radio', { name })).not.toBeInTheDocument()
  expect(screen.queryByText('Hands-free')).not.toBeInTheDocument()
  const patient = screen.getByRole('radio', { name: 'Patient 4 sec' })
  expect(patient).toBeEnabled()
  fireEvent.click(patient)
  expect(JSON.parse(Object.values({ ...localStorage })[0] as string)).toMatchObject({ silenceSeconds: 4 })
})
