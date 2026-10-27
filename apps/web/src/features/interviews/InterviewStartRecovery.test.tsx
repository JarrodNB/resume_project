/** Exercise explicit blocked-start recovery without losing the selected job or round choices. */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { MockLink } from '@apollo/client/testing'
import type { InterviewSetupInput } from '@/graphql/generated/graphql'
import { JOB_QUERY } from '@/features/jobs/jobsOperations'
import { renderPage } from '@/test/renderPage'
import { InterviewSetup } from './InterviewSetup'
import { JobInterviewSetupPage } from './JobInterviewSetupPage'
import { ABANDON_UNFINISHED_INTERVIEW, START_INTERVIEW, UNFINISHED_INTERVIEW } from './interviewOperations'

vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }))
const job = { id: 'selected-job', title: 'Laboratory technician', company: 'Sample Labs', description: null,
  requirements: [], responsibilities: [], niceToHaves: [] }
const blocker = { __typename: 'InterviewSession', id: 'older-session', status: 'active', jobContext: {
  __typename: 'InterviewJobContext', id: null, title: 'Original frozen job', company: 'Original company',
} }
const unfinished = (value: typeof blocker | null): MockLink.MockedResponse => ({ request: { query: UNFINISHED_INTERVIEW }, result: { data: { unfinishedInterviewSession: value } } })
function mount(mocks: MockLink.MockedResponse[]) {
  return renderPage({ path: '/jobs/:jobId/interview', url: '/jobs/selected-job/interview',
    element: <InterviewSetup job={job} notice={null} />, mocks,
    extraRoutes: [{ path: '/interviews/:id', element: <p>Saved interview</p> }],
  })
}
beforeEach(() => { localStorage.clear(); vi.clearAllMocks() })

const defaultSetup: InterviewSetupInput = { questionCount: 8, questionFormat: 'mixed', difficulty: 'realistic', interviewer: 'daniel', focusAreas: [] }
function startMock(setup = defaultSetup, result = vi.fn()): MockLink.MockedResponse {
  return { request: { query: START_INTERVIEW, variables: { careerFocus: null, setup, jobId: job.id } }, result }
}
function started() {
  return { data: { startInterviewDemo: { __typename: 'StartInterviewDemoPayload', errors: [], interview: {
    __typename: 'InterviewSession', id: 'new-session', status: 'preparing', interviewType: 'basic', executionMode: 'real', speechPlaybackMode: 'browser',
    preparedRole: {}, revision: 0, answerCap: 3, currentQuestionPosition: 0, expiresAt: '2026-11-01T00:00:00Z',
    jobContext: { ...job, __typename: 'InterviewJobContext' }, setup: { ...defaultSetup, __typename: 'InterviewSetup' }, questions: [], messages: [], operations: [],
  } } } }
}

it('shows the actual unfinished interview and blocks preparation until explicitly resolved', async () => {
  mount([unfinished(blocker)])
  expect(await screen.findByRole('link', { name: 'Resume interview' })).toHaveAttribute('href', '/interviews/older-session')
  expect(screen.getByText('Original frozen job')).toBeVisible()
  expect(screen.getByText('Original company')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Prepare interview' })).toBeDisabled()
  fireEvent.click(screen.getByRole('link', { name: 'Resume interview' }))
  expect(await screen.findByText('Saved interview')).toBeVisible()
})

it('keeps every round choice and the selected job after explicit abandonment without starting automatically', async () => {
  const setup = { questionCount: 5, questionFormat: 'technical', difficulty: 'stretch', interviewer: 'maya', focusAreas: ['leadership'] }
  const prepare = vi.fn(started)
  mount([unfinished(blocker), {
    request: { query: ABANDON_UNFINISHED_INTERVIEW, variables: { interviewId: blocker.id } },
    result: { data: { abandonInterview: { __typename: 'AbandonInterviewPayload', errors: [], interview: { __typename: 'InterviewSession', id: blocker.id, status: 'abandoned' } } } },
  }, unfinished(null), startMock(setup, prepare)])
  await screen.findByRole('link', { name: 'Resume interview' })
  fireEvent.click(screen.getByRole('radio', { name: /Technical \/ Role/ }))
  fireEvent.click(screen.getByRole('radio', { name: /Stretch/ }))
  fireEvent.click(screen.getByRole('radio', { name: /Maya/ }))
  fireEvent.click(screen.getByRole('radio', { name: /Short/ }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Leadership' }))
  fireEvent.click(screen.getByRole('button', { name: 'Abandon interview' }))
  expect(prepare).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Confirm abandonment' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare interview' })).toBeEnabled())
  expect(prepare).not.toHaveBeenCalled()
  expect(screen.getByRole('radio', { name: /Technical \/ Role/ })).toBeChecked()
  expect(screen.getByRole('radio', { name: /Stretch/ })).toBeChecked()
  expect(screen.getByRole('radio', { name: /Maya/ })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Leadership' })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Prepare interview' }))
  expect(await screen.findByText('Saved interview')).toBeVisible()
  expect(prepare).toHaveBeenCalledTimes(1)
})

it('recovers a lost start reply with an owned read and never automatically replays preparation', async () => {
  const replay = vi.fn(started)
  mount([unfinished(null), { ...startMock(), result: undefined, error: new Error('Lost reply') }, unfinished(blocker), startMock(defaultSetup, replay)])
  await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare interview' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Prepare interview' }))
  expect(await screen.findByRole('link', { name: 'Resume interview' })).toHaveAttribute('href', '/interviews/older-session')
  expect(screen.getByRole('button', { name: 'Prepare interview' })).toBeDisabled()
  expect(replay).not.toHaveBeenCalled()
})

it('requires a successful status read and an explicit retry after uncertain preparation', async () => {
  const retry = vi.fn(started)
  mount([unfinished(null), { ...startMock(), result: undefined, error: new Error('Lost reply') },
    { request: { query: UNFINISHED_INTERVIEW }, error: new Error('Read unavailable') }, unfinished(null), startMock(defaultSetup, retry)])
  await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare interview' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Prepare interview' }))
  await screen.findByText('Could not check your saved interviews. Try again before preparing.')
  expect(screen.getByRole('button', { name: 'Prepare interview' })).toBeDisabled()
  expect(retry).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Check saved interviews' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare interview' })).toBeEnabled())
  expect(retry).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Prepare interview' }))
  expect(await screen.findByText('Saved interview')).toBeVisible()
  expect(retry).toHaveBeenCalledTimes(1)
})

it('keeps the blocker and choices when abandonment is rejected', async () => {
  mount([unfinished(blocker), { request: { query: ABANDON_UNFINISHED_INTERVIEW, variables: { interviewId: blocker.id } },
    result: { data: { abandonInterview: { __typename: 'AbandonInterviewPayload', interview: null, errors: ['Unable to abandon'] } } } }])
  await screen.findByRole('link', { name: 'Resume interview' })
  fireEvent.click(screen.getByRole('radio', { name: /Short/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Abandon interview' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm abandonment' }))
  expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent('Could not end the unfinished interview')
  fireEvent.click(screen.getByRole('button', { name: 'Keep interview' }))
  expect(screen.getByRole('link', { name: 'Resume interview' })).toBeVisible()
  expect(screen.getByRole('radio', { name: /Short/ })).toBeChecked()
  expect(screen.getByRole('button', { name: 'Prepare interview' })).toBeDisabled()
})

it('offers another saved job when the selected source is deleted after setup has loaded', async () => {
  const reject = vi.fn(() => ({ data: { startInterviewDemo: { __typename: 'StartInterviewDemoPayload', interview: null, errors: ['Record not found'] } } }))
  renderPage({ path: '/jobs/:jobId/interview', url: '/jobs/selected-job/interview', element: <JobInterviewSetupPage />,
    mocks: [
      { request: { query: JOB_QUERY, variables: { id: job.id } }, result: { data: { job: { ...job, __typename: 'Job',
        stage: 'UNAPPLIED', location: null, url: null, notes: null, appliedAt: null, gapResponses: [], latestGapAnalysis: null, resume: null } } } },
      unfinished(null), startMock(defaultSetup, reject), unfinished(null),
    ],
    extraRoutes: [{ path: '/jobs', element: <p>My saved jobs</p> }],
  })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare interview' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Prepare interview' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Record not found')
  await screen.findByText('No unfinished interview was found. Your choices are kept; choose Prepare interview to try again.')
  expect(reject).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('link', { name: 'Choose another job' }))
  expect(await screen.findByText('My saved jobs')).toBeVisible()
  expect(reject).toHaveBeenCalledTimes(1)
})
