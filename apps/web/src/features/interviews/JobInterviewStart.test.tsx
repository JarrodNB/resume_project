/** Starting an interview for a saved job keeps the round choices, even when the start is rejected. */
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { MockLink } from '@apollo/client/testing'
import type { InterviewSetupInput } from '@/graphql/generated/graphql'
import { JOB_QUERY } from '@/features/jobs/jobsOperations'
import { renderPage } from '@/test/renderPage'
import { InterviewSetup } from './InterviewSetup'
import { JobWorkspaceLayout } from '@/features/jobs/JobWorkspaceLayout'
import { JobInterviewTab } from './JobInterviewTab'
import { START_INTERVIEW } from './interviewOperations'

vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }))
const job = { id: 'selected-job', title: 'Laboratory technician', company: 'Sample Labs', description: null,
  requirements: [], responsibilities: [], niceToHaves: [] }
const defaultSetup: InterviewSetupInput = { questionCount: 8, questionFormat: 'mixed', difficulty: 'realistic', interviewer: 'daniel', focusAreas: [] }
function startMock(setup = defaultSetup, result = vi.fn()): MockLink.MockedResponse {
  return { request: { query: START_INTERVIEW, variables: { careerFocus: null, setup, jobId: job.id } }, result }
}
function started() {
  return { data: { startInterview: { __typename: 'StartInterviewPayload', errors: [], interview: {
    __typename: 'InterviewSession', id: 'new-session', status: 'preparing', interviewType: 'basic', executionMode: 'real', speechPlaybackMode: 'browser',
    preparedRole: {}, revision: 0, answerCap: 3, currentQuestionPosition: 0, expiresAt: '2026-11-01T00:00:00Z',
    jobContext: { ...job, __typename: 'InterviewJobContext' }, setup: { ...defaultSetup, __typename: 'InterviewSetup' }, questions: [], messages: [], operations: [],
  } } } }
}

function mount(mocks: MockLink.MockedResponse[]) {
  return renderPage({ path: '/jobs/:jobId/interview', url: '/jobs/selected-job/interview',
    element: <InterviewSetup job={job} notice={null} />, mocks,
    extraRoutes: [{ path: '/practice/interviews/:id', element: <p>Saved interview</p> }],
  })
}
beforeEach(() => { localStorage.clear(); vi.clearAllMocks() })

it('starts the chosen round for the selected job without checking for other interviews', async () => {
  const setup = { questionCount: 5, questionFormat: 'technical', difficulty: 'stretch', interviewer: 'maya', focusAreas: ['leadership'] }
  const prepare = vi.fn(started)
  mount([startMock(setup, prepare)])
  fireEvent.click(screen.getByRole('radio', { name: /Technical \/ Role/ }))
  fireEvent.click(screen.getByRole('radio', { name: /Stretch/ }))
  fireEvent.click(screen.getByRole('radio', { name: /Maya/ }))
  fireEvent.click(screen.getByRole('radio', { name: /Short/ }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Leadership' }))
  fireEvent.click(screen.getByRole('button', { name: 'Continue to settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Prepare interview' }))
  expect(await screen.findByText('Saved interview')).toBeVisible()
  expect(prepare).toHaveBeenCalledTimes(1)
})

it('shows the error and allows another try when the selected job is deleted after setup has loaded', async () => {
  const reject = vi.fn(() => ({ data: { startInterview: { __typename: 'StartInterviewPayload', interview: null, errors: ['Record not found'] } } }))
  renderPage({ path: '/jobs/:id', url: '/jobs/selected-job/interview', element: <JobWorkspaceLayout />,
    children: [{ path: 'interview', element: <JobInterviewTab /> }],
    mocks: [
      { request: { query: JOB_QUERY, variables: { id: job.id } }, result: { data: { job: { ...job, __typename: 'Job',
        stage: 'UNAPPLIED', location: null, url: null, notes: null, appliedAt: null, gapResponses: [], latestGapAnalysis: null, resume: null } } } },
      startMock(defaultSetup, reject),
    ],
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Continue to settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Prepare interview' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Record not found')
  expect(reject).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Prepare interview' })).toBeEnabled()
})
