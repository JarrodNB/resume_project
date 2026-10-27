/** Verifies saved-job setup keeps the source explicit while reusing round choices. */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { InterviewSetup } from './InterviewSetup'
import { UNFINISHED_INTERVIEW } from './interviewOperations'

const { start } = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock('./useInterviewSession', () => ({ useStartInterview: () => ({ start, loading: false, error: null }) }))
vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }))
const job = { id: 'job-1', title: 'Laboratory technician', company: 'Sample Labs', description: null,
  requirements: [], responsibilities: [], niceToHaves: [] }

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); start.mockResolvedValue('session') })

it('prepares for the selected job with limited-context copy and the existing round choices', async () => {
  const { router } = renderPage({ path: '/jobs/:jobId/interview', url: '/jobs/job-1/interview',
    element: <InterviewSetup notice={null} job={job} />,
    mocks: [{ request: { query: UNFINISHED_INTERVIEW }, result: { data: { unfinishedInterviewSession: null } } }],
    extraRoutes: [{ path: '/interviews/:id', element: <p>Saved interview preparation</p> }],
  })
  expect(screen.getByRole('heading', { name: 'Laboratory technician' })).toBeVisible()
  expect(screen.getByText(/This job only has a title/)).toBeVisible()
  expect(screen.queryByText(/prepare a fictional role/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: /Stretch/ }))
  fireEvent.click(screen.getByRole('radio', { name: /Short/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare interview' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Prepare interview' }))
  expect(start).toHaveBeenCalledWith('', { questionCount: 5, questionFormat: 'mixed', difficulty: 'stretch',
    interviewer: 'daniel', focusAreas: [] }, 'job-1')
  expect(await screen.findByText('Saved interview preparation')).toBeVisible()
  expect(router.state.location.pathname).toBe('/interviews/session')
})
