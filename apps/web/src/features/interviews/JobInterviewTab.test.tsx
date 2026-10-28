/** The job workspace's Interview tab sets up practice for the loaded job, restores saved round
 * choices, and never falls back to generic practice when the job can't be loaded. */
import { GraphQLError } from 'graphql'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { JOB_QUERY } from '@/features/jobs/jobsOperations'
import { JobWorkspaceLayout } from '@/features/jobs/JobWorkspaceLayout'
import { JobInterviewTab } from './JobInterviewTab'
import { UNFINISHED_INTERVIEW } from './interviewOperations'

const { start } = vi.hoisted(() => ({ start: vi.fn() }))
vi.mock('./useInterviewSession', () => ({ useStartInterview: () => ({ start, loading: false, error: null }), useInterviewSession: vi.fn() }))
vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }))
const job = { __typename: 'Job', id: 'job-1', title: 'Laboratory technician', company: null, location: null,
  stage: 'UNAPPLIED', url: null, description: 'Maintain laboratory instruments.', notes: null, appliedAt: null,
  requirements: ['Calibration'], responsibilities: [], niceToHaves: [], gapResponses: [], latestGapAnalysis: null, resume: null }
const request = { query: JOB_QUERY, variables: { id: 'job-1' } }
const interviewTab = [{ path: 'interview', element: <JobInterviewTab /> }]
function mount(available = true, historyState?: unknown) {
  return renderPage({ path: '/jobs/:id', url: '/jobs/job-1/interview', historyState, element: <JobWorkspaceLayout />, children: interviewTab,
    mocks: [available ? { request, result: { data: { job } } } : { request, result: { errors: [new GraphQLError('Record not found')] } },
      { request: { query: UNFINISHED_INTERVIEW }, result: { data: { unfinishedInterviewSession: null } } }],
    extraRoutes: [{ path: '/practice/interviews/:id', element: <p>Saved preparation</p> }, { path: '/jobs', element: <p>My jobs</p> }],
  })
}
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); start.mockResolvedValue('session') })

it('restores the saved round choices when repeating practice for the same job', async () => {
  mount(true, { practiceSetup: { questionCount: 5, questionFormat: 'technical', difficulty: 'stretch', interviewer: 'maya', focusAreas: ['leadership'] } })
  await screen.findByRole('heading', { level: 1, name: 'Laboratory technician' })
  expect(screen.getByRole('radio', { name: /Technical \/ Role/ })).toBeChecked()
  expect(screen.getByRole('radio', { name: /Stretch/ })).toBeChecked()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare interview' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Prepare interview' }))
  expect(start).toHaveBeenCalledWith('', { questionCount: 5, questionFormat: 'technical', difficulty: 'stretch', interviewer: 'maya', focusAreas: ['leadership'] }, 'job-1')
})

it('says the interview ended when an abandoned job interview returns here', async () => {
  mount(true, { interviewEnded: 'abandoned' })
  expect(await screen.findByText('Interview ended. You can prepare another whenever you’re ready.')).toBeVisible()
})

it('loads selection from the route again on reload, then starts practice for that exact job', async () => {
  const first = mount()
  expect(screen.getByRole('status')).toHaveTextContent('Loading job')
  await screen.findByRole('heading', { level: 1, name: 'Laboratory technician' })
  first.unmount()
  mount()
  expect(await screen.findByRole('heading', { level: 1, name: 'Laboratory technician' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Interview' })).toHaveAttribute('aria-current', 'page')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare interview' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Prepare interview' }))
  expect(start).toHaveBeenCalledWith('', expect.objectContaining({ questionCount: 8, questionFormat: 'mixed' }), 'job-1')
  expect(await screen.findByText('Saved preparation')).toBeVisible()
})

it('keeps unavailable jobs out of setup instead of offering generic preparation', async () => {
  mount(false)
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load this job")
  expect(screen.queryByRole('button', { name: 'Prepare interview' })).not.toBeInTheDocument()
  expect(start).not.toHaveBeenCalled()
})

it('keeps setup closed when loading the job fails on the network', async () => {
  renderPage({ path: '/jobs/:id', url: '/jobs/job-1/interview', element: <JobWorkspaceLayout />, children: interviewTab,
    mocks: [
      { request, error: new Error('Connection unavailable') },
      { request: { query: UNFINISHED_INTERVIEW }, result: { data: { unfinishedInterviewSession: null } } },
    ],
  })
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load this job")
  expect(screen.queryByRole('button', { name: 'Prepare interview' })).not.toBeInTheDocument()
  expect(start).not.toHaveBeenCalled()
})
