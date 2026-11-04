/** Verifies saved-job setup keeps the source explicit while reusing round choices. */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { InterviewSetup } from './InterviewSetup'

const { start } = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock('./useInterviewSession', () => ({ useStartInterview: () => ({ start, loading: false, error: null }) }))
vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }))
const job = { id: 'job-1', title: 'Laboratory technician', company: 'Sample Labs', description: null,
  requirements: [], responsibilities: [], niceToHaves: [] }

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); start.mockResolvedValue('session') })

it('starts the selected saved job with the chosen round settings', async () => {
  const { router } = renderPage({ path: '/jobs/:jobId/interview', url: '/jobs/job-1/interview',
    element: <InterviewSetup notice={null} job={job} />,
    mocks: [],
    extraRoutes: [{ path: '/practice/interviews/:id', element: <p>Saved interview preparation</p> }],
  })
  expect(screen.getByRole('heading', { name: 'Set up your interview' })).toBeVisible()
  expect(screen.getByText('Choose your round for this saved job.')).toBeVisible()
  expect(screen.queryByText(/prepare a fictional role/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: /Stretch/ }))
  fireEvent.click(screen.getByRole('radio', { name: /Short/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Continue to settings' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Continue to settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Start interview' }))
  expect(start).toHaveBeenCalledWith('', { questionCount: 5, questionFormat: 'mixed', difficulty: 'stretch',
    interviewer: 'daniel', focusAreas: [] }, 'job-1')
  expect(await screen.findByText('Saved interview preparation')).toBeVisible()
  expect(router.state.location.pathname).toBe('/practice/interviews/session')
})

it('stays on the settings step after Continue instead of starting preparation', async () => {
  renderPage({ path: '/jobs/:jobId/interview', url: '/jobs/job-1/interview', element: <InterviewSetup notice={null} job={job} />, mocks: [] })
  fireEvent.click(screen.getByRole('button', { name: 'Continue to settings' }))
  expect(await screen.findByRole('heading', { name: 'How you’ll answer' })).toBeVisible()
  expect(start).not.toHaveBeenCalled()
})
