/** Route-based job setup reloads its owned source and cannot fall back to generic practice. */
import { GraphQLError } from 'graphql'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { JOB_QUERY } from '@/features/jobs/jobsOperations'
import { JobInterviewSetupPage } from './JobInterviewSetupPage'

const { start } = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock('./useInterviewSession', () => ({ useStartInterview: () => ({ start, loading: false, error: null }), useInterviewSession: vi.fn() }))
vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }))
const job = { __typename: 'Job', id: 'job-1', title: 'Laboratory technician', company: null, location: null,
  stage: 'UNAPPLIED', url: null, description: 'Maintain laboratory instruments.', notes: null, appliedAt: null,
  requirements: ['Calibration'], responsibilities: [], niceToHaves: [], gapResponses: [], latestGapAnalysis: null, resume: null }
const request = { query: JOB_QUERY, variables: { id: 'job-1' } }
function mount(available = true, historyState?: unknown) {
  return renderPage({ path: '/jobs/:jobId/interview', url: '/jobs/job-1/interview', historyState, element: <JobInterviewSetupPage />,
    mocks: [available ? { request, result: { data: { job } } } : { request, result: { errors: [new GraphQLError('Record not found')] } }],
    extraRoutes: [{ path: '/interviews/:id', element: <p>Saved preparation</p> }, { path: '/jobs', element: <p>My jobs</p> }],
  })
}
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); start.mockResolvedValue('session') })

it('restores the saved round choices when repeating practice for the same job', async () => {
  mount(true, { practiceSetup: { questionCount: 5, questionFormat: 'technical', difficulty: 'stretch', interviewer: 'maya', focusAreas: ['leadership'] } })
  await screen.findByRole('heading', { name: 'Laboratory technician' })
  expect(screen.getByRole('radio', { name: /Technical \/ Role/ })).toBeChecked()
  expect(screen.getByRole('radio', { name: /Stretch/ })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Prepare interview' }))
  expect(start).toHaveBeenCalledWith('', { questionCount: 5, questionFormat: 'technical', difficulty: 'stretch', interviewer: 'maya', focusAreas: ['leadership'] }, 'job-1')
})

it('loads selection from the route again on reload, then starts practice for that exact job', async () => {
  const first = mount()
  expect(screen.getByRole('status')).toHaveTextContent('Loading saved job')
  await screen.findByRole('heading', { name: 'Laboratory technician' })
  first.unmount()
  mount()
  expect(await screen.findByRole('heading', { name: 'Laboratory technician' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Back to job' })).toHaveAttribute('href', '/jobs/job-1')
  fireEvent.click(screen.getByRole('button', { name: 'Prepare interview' }))
  expect(start).toHaveBeenCalledWith('', expect.objectContaining({ questionCount: 8, questionFormat: 'mixed' }), 'job-1')
  expect(await screen.findByText('Saved preparation')).toBeVisible()
})

it('keeps unavailable jobs out of setup instead of offering generic preparation', async () => {
  mount(false)
  expect(await screen.findByRole('alert')).toHaveTextContent('This saved job is unavailable')
  expect(screen.queryByRole('button', { name: 'Prepare interview' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'All jobs' })).toHaveAttribute('href', '/jobs')
  expect(start).not.toHaveBeenCalled()
})
