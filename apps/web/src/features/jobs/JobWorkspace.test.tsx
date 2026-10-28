/**
 * Checks the saved-job workspace: the header (edit, stage, archive, visit website, applied date,
 * the write-resume flow and its compare-first dialog), the tab links, the import notice, and the
 * Fit and Posting tabs. The Resume, Study, and Interview tabs are stand-ins here; their own tests
 * cover them.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApolloClient, ApolloLink, InMemoryCache } from '@apollo/client'
import { ApolloProvider } from '@apollo/client/react'
import { MockLink, MockSubscriptionLink } from '@apollo/client/testing'
import type { MockLink as MockLinkTypes } from '@apollo/client/testing'
import { expect, it, vi } from 'vitest'
import { ANALYZE_JOB_GAPS_MUTATION } from '@/features/gap-analysis/gapAnalysisOperations'
import { renderPage } from '@/test/renderPage'
import { JobFitTab, JobPostingTab } from './JobWorkspaceTabs'
import { JobWorkspaceLayout } from './JobWorkspaceLayout'
import { ARCHIVE_JOB_MUTATION, JOB_QUERY, MOVE_JOB_TO_STAGE_MUTATION, UPDATE_JOB_MUTATION } from './jobsOperations'

function job(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'Job',
    id: 'job-1',
    title: 'Engineer',
    company: 'Acme',
    location: 'Remote',
    stage: 'UNAPPLIED',
    url: null,
    description: null,
    notes: null,
    appliedAt: null,
    requirements: ['Python'],
    responsibilities: [],
    niceToHaves: [],
    gapResponses: [],
    latestGapAnalysis: null,
    resume: null,
    ...overrides,
  }
}

function jobQuery(data: ReturnType<typeof job>) {
  return { request: { query: JOB_QUERY, variables: { id: 'job-1' } }, result: { data: { job: data } } }
}

/** The workspace's tabs: real Fit and Posting tabs, stand-ins for the rest. */
const workspaceTabs = [
  { index: true, element: <JobFitTab /> },
  { path: 'resume', element: <p>Resume tab</p> },
  { path: 'resume/write', element: <p>Writing resume</p> },
  { path: 'study', element: <p>Study tab</p> },
  { path: 'interview', element: <p>Interview tab</p> },
  { path: 'posting', element: <JobPostingTab /> },
]

/** Renders the workspace at `url` (the Fit tab by default). */
function renderWorkspace({ url = '/jobs/job-1', ...options }: Partial<Parameters<typeof renderPage>[0]> = {}) {
  return renderPage({ path: '/jobs/:id', url, element: <JobWorkspaceLayout />, children: workspaceTabs, ...options })
}

/** Opens the header's "More job actions" menu. */
async function openActionsMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'More job actions' }))
}

const savedAttributes = {
  title: 'Senior Engineer',
  company: 'Acme',
  location: null,
  url: null,
  notes: null,
  description: null,
  requirements: ['Python'],
  responsibilities: [],
  niceToHaves: [],
}

it('links each tab to its route and marks the open one as current', async () => {
  const user = userEvent.setup()
  const { router } = renderWorkspace({ mocks: [jobQuery(job())] })
  const tabs = within(await screen.findByRole('navigation', { name: 'Job sections' }))
  const expected = { Fit: '/jobs/job-1', Resume: '/jobs/job-1/resume', Study: '/jobs/job-1/study', Interview: '/jobs/job-1/interview', Posting: '/jobs/job-1/posting' }
  for (const [name, href] of Object.entries(expected)) expect(tabs.getByRole('link', { name })).toHaveAttribute('href', href)
  expect(tabs.getByRole('link', { name: 'Fit' })).toHaveAttribute('aria-current', 'page')
  expect(tabs.getByRole('link', { name: 'Interview' })).not.toHaveAttribute('aria-current')

  await user.click(tabs.getByRole('link', { name: 'Interview' }))
  expect(router.state.location.pathname).toBe('/jobs/job-1/interview')
  expect(screen.getByText('Interview tab')).toBeVisible()
  expect(tabs.getByRole('link', { name: 'Interview' })).toHaveAttribute('aria-current', 'page')
  expect(tabs.getByRole('link', { name: 'Fit' })).not.toHaveAttribute('aria-current')
})

it('keeps the Resume tab current while writing a resume', async () => {
  renderWorkspace({ url: '/jobs/job-1/resume/write', mocks: [jobQuery(job())] })
  await screen.findByText('Writing resume')
  const tabs = within(screen.getByRole('navigation', { name: 'Job sections' }))
  expect(tabs.getByRole('link', { name: 'Resume' })).toHaveAttribute('aria-current', 'page')
})

it('hides the header Write resume once the job has a resume', async () => {
  renderWorkspace({ mocks: [jobQuery(job({ resume: { __typename: 'Resume', id: 'resume-1' } }))] })
  await screen.findByRole('heading', { name: 'Engineer' })
  expect(screen.queryByRole('button', { name: 'Write resume' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Write resume' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Open resume' })).not.toBeInTheDocument()
})

it('hides the header Write resume on the Resume tab, which offers its own', async () => {
  const { router } = renderWorkspace({ url: '/jobs/job-1/resume', mocks: [jobQuery(job())] })
  await screen.findByText('Resume tab')
  expect(screen.queryByRole('button', { name: 'Write resume' })).not.toBeInTheDocument()
  await act(() => router.navigate('/jobs/job-1/posting'))
  expect(await screen.findByRole('button', { name: 'Write resume' })).toBeInTheDocument()
})

it('shows the posting content as open sections with the full description collapsed', async () => {
  const user = userEvent.setup()
  renderWorkspace({ url: '/jobs/job-1/posting', mocks: [jobQuery(job({
    requirements: ['Python', 'SQL'], responsibilities: ['Ship features'], niceToHaves: ['Go'],
    notes: 'Ask about on-call.', description: 'A long job description.',
  }))] })

  const requirements = await screen.findByRole('heading', { level: 2, name: 'Requirements' })
  expect(within(requirements.closest('section')!).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Python', 'SQL'])
  expect(screen.getByRole('heading', { level: 2, name: 'Responsibilities' })).toBeInTheDocument()
  expect(screen.getByText('Ship features')).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 2, name: 'Nice to have' })).toBeInTheDocument()
  expect(screen.getByText('Go')).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 2, name: 'Notes' })).toBeInTheDocument()
  expect(screen.getByText('Ask about on-call.')).toBeInTheDocument()
  expect(screen.queryByText('A long job description.')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /Full description/ }))
  expect(screen.getByText('A long job description.')).toBeInTheDocument()
})

it('explains empty requirements and leaves out empty optional posting sections', async () => {
  renderWorkspace({ url: '/jobs/job-1/posting', mocks: [jobQuery(job({ requirements: [] }))] })

  expect(await screen.findByText('No requirements were found in the posting.')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Responsibilities' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Nice to have' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Notes' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Full description/ })).not.toBeInTheDocument()
})

it('shows a load error instead of the workspace when the job is unavailable', async () => {
  renderWorkspace({ mocks: [{ request: { query: JOB_QUERY, variables: { id: 'job-1' } }, error: new Error('Record not found') }] })

  expect(await screen.findByText("Couldn't load this job")).toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: 'Job sections' })).not.toBeInTheDocument()
})

it('offers the saved website in a new tab without changing the application stage', async () => {
  const user = userEvent.setup()
  const moveStage = vi.fn(() => ({ data: { moveJobToStage: { __typename: 'MoveJobToStagePayload', errors: [] } } }))
  renderWorkspace({
    mocks: [
      jobQuery(job({ url: 'https://example.com/careers/engineer' })),
      { request: { query: MOVE_JOB_TO_STAGE_MUTATION, variables: () => true }, result: moveStage },
    ],
  })

  await openActionsMenu(user)
  const website = screen.getByRole('menuitem', { name: 'Visit website' })
  expect(website).toHaveAttribute('href', 'https://example.com/careers/engineer')
  expect(website).toHaveAttribute('target', '_blank')
  expect(website).toHaveAttribute('rel', 'noreferrer')
  await user.click(website)
  expect(moveStage).not.toHaveBeenCalled()
  expect(screen.getByRole('combobox', { name: 'Stage' })).toHaveValue('UNAPPLIED')
})

it('omits the website action when no URL is saved', async () => {
  const user = userEvent.setup()
  renderWorkspace({ mocks: [jobQuery(job())] })

  await openActionsMenu(user)
  expect(screen.getByRole('menuitem', { name: 'Edit job' })).toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: 'Visit website' })).not.toBeInTheDocument()
})

it('saves an edit and clears an optional field', async () => {
  const user = userEvent.setup()
  renderWorkspace({
    mocks: [
      jobQuery(job()),
      {
        request: { query: UPDATE_JOB_MUTATION, variables: { id: 'job-1', attributes: savedAttributes } },
        result: { data: { updateJob: { __typename: 'UpdateJobPayload', errors: [] } } },
      },
      jobQuery(job({ title: 'Senior Engineer', location: null })),
    ],
  })

  await openActionsMenu(user)
  await user.click(screen.getByRole('menuitem', { name: 'Edit job' }))
  await user.clear(screen.getByLabelText('Title'))
  await user.type(screen.getByLabelText('Title'), 'Senior Engineer')
  await user.clear(screen.getByLabelText('Location'))
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(await screen.findByRole('heading', { name: 'Senior Engineer' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Edit job' })).not.toBeInTheDocument()
  expect(screen.queryByText('Remote')).not.toBeInTheDocument()
})

it('clears the company and displays Unknown company', async () => {
  const user = userEvent.setup()
  renderWorkspace({
    mocks: [
      jobQuery(job()),
      {
        request: { query: UPDATE_JOB_MUTATION, variables: { id: 'job-1', attributes: { ...savedAttributes, title: 'Engineer', company: null, location: 'Remote' } } },
        result: { data: { updateJob: { __typename: 'UpdateJobPayload', errors: [] } } },
      },
      jobQuery(job({ company: null })),
    ],
  })

  await openActionsMenu(user)
  await user.click(screen.getByRole('menuitem', { name: 'Edit job' }))
  await user.clear(screen.getByLabelText('Company'))
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(await screen.findByText('Unknown company · Remote')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Edit job' })).not.toBeInTheDocument()
})

it('opens an unknown company as an empty field and lets the user add it', async () => {
  const user = userEvent.setup()
  renderWorkspace({
    mocks: [
      jobQuery(job({ company: null })),
      {
        request: { query: UPDATE_JOB_MUTATION, variables: { id: 'job-1', attributes: { ...savedAttributes, title: 'Engineer', location: 'Remote' } } },
        result: { data: { updateJob: { __typename: 'UpdateJobPayload', errors: [] } } },
      },
      jobQuery(job()),
    ],
  })
  await openActionsMenu(user)
  await user.click(screen.getByRole('menuitem', { name: 'Edit job' }))
  expect(screen.getByLabelText('Company')).toHaveValue('')
  await user.type(screen.getByLabelText('Company'), 'Acme')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('Acme · Remote')).toBeInTheDocument()
})

it('moves the job to a new stage', async () => {
  const user = userEvent.setup()
  renderWorkspace({
    mocks: [
      jobQuery(job()),
      {
        request: { query: MOVE_JOB_TO_STAGE_MUTATION, variables: { id: 'job-1', stage: 'APPLIED' } },
        result: { data: { moveJobToStage: { __typename: 'MoveJobToStagePayload', errors: [] } } },
      },
      jobQuery(job({ stage: 'APPLIED', appliedAt: '2026-10-06T00:00:00Z' })),
    ],
  })

  await user.selectOptions(await screen.findByLabelText('Stage'), 'APPLIED')

  await waitFor(() => expect(screen.getByLabelText('Stage')).toHaveValue('APPLIED'))
  expect(screen.getByText(/Applied \d/)).toBeInTheDocument()
})

it('archives the job from any tab after confirmation and returns to the jobs list', async () => {
  const user = userEvent.setup()
  const { router } = renderWorkspace({
    url: '/jobs/job-1/posting',
    extraRoutes: [{ path: '/jobs', element: <p>Jobs list</p> }],
    mocks: [
      jobQuery(job()),
      {
        request: { query: ARCHIVE_JOB_MUTATION, variables: { id: 'job-1' } },
        result: { data: { archiveJob: { __typename: 'ArchiveJobPayload', errors: [] } } },
      },
    ],
  })

  await openActionsMenu(user)
  await user.click(screen.getByRole('menuitem', { name: 'Archive job' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive' }))

  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs'))
  expect(screen.getByText('Jobs list')).toBeVisible()
})

it('keeps the workspace open and shows an archive failure', async () => {
  const user = userEvent.setup()
  const { router } = renderWorkspace({ mocks: [
    jobQuery(job()),
    {
      request: { query: ARCHIVE_JOB_MUTATION, variables: { id: 'job-1' } },
      result: { data: { archiveJob: { __typename: 'ArchiveJobPayload', errors: ['Could not archive this job'] } } },
    },
  ] })
  await openActionsMenu(user)
  await user.click(screen.getByRole('menuitem', { name: 'Archive job' }))
  expect(screen.getByText(/Your answers, resumes, and interview history are kept/)).toBeVisible()
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive' }))
  expect(await screen.findByText('Could not archive this job')).toBeVisible()
  expect(router.state.location.pathname).toBe('/jobs/job-1')
})

it('starts the comparison from the dialog and blocks writing during the request', async () => {
  const user = userEvent.setup()
  const started = vi.fn(() => ({ data: { analyzeJobGaps: {
    __typename: 'AnalyzeJobGapsPayload', errors: [], aiTask: {
      __typename: 'AiTask', id: 'task-1', status: 'QUEUED', result: null,
      errorMessage: null, createdAt: '2026-10-01T00:00:00Z',
    },
  } } }))
  const { router } = renderLiveJob(job(), [{
    request: { query: ANALYZE_JOB_GAPS_MUTATION, variables: { jobId: 'job-1' } },
    delay: 150, result: started,
  }])
  await user.click(await screen.findByRole('button', { name: 'Write resume' }))
  await user.click(screen.getByRole('button', { name: 'Compare first' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Write resume' })).toBeDisabled()
  await waitFor(() => expect(started).toHaveBeenCalledTimes(1))
  expect(await screen.findByText(/Comparing this job/)).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/jobs/job-1')
})

it('allows writing without comparing', async () => {
  const user = userEvent.setup()
  const { router } = renderWorkspace({ mocks: [jobQuery(job())] })
  await user.click(await screen.findByRole('button', { name: 'Write resume' }))
  await user.click(screen.getByRole('button', { name: 'Write resume anyway' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs/job-1/resume/write'))
})

it('writes a resume without asking after a comparison has finished', async () => {
  const user = userEvent.setup()
  const { router } = renderWorkspace({
    mocks: [
      jobQuery(
        job({
          latestGapAnalysis: {
            __typename: 'AiTask',
            id: 'task-1',
            status: 'COMPLETED',
            result: null,
            errorMessage: null,
            createdAt: '2026-10-01T00:00:00Z',
          },
        }),
      ),
    ],
  })

  await user.click(await screen.findByRole('link', { name: 'Write resume' }))

  expect(screen.queryByRole('heading', { name: 'Compare this job first?' })).not.toBeInTheDocument()
  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs/job-1/resume/write'))
})

function comparisonTask(status = 'QUEUED') {
  return { __typename: 'AiTask', id: 'task-1', status, result: null,
    errorMessage: status === 'FAILED' ? 'Comparison unavailable' : null, createdAt: '2026-10-01T00:00:00Z' }
}

/** Uses the real Apollo subscription boundary to deliver multiple updates to one mounted page. */
function renderLiveJob(data = job(), mocks: MockLinkTypes.MockedResponse[] = []) {
  const updates = new MockSubscriptionLink()
  const client = new ApolloClient({ cache: new InMemoryCache(), link: ApolloLink.split(
    operation => operation.operationName === 'AiTaskUpdated', updates, new MockLink([jobQuery(data), ...mocks]),
  ) })
  const page = renderWorkspace({ element: <ApolloProvider client={client}><JobWorkspaceLayout /></ApolloProvider> })
  return { ...page, updates, client }
}

function updateComparison(updates: MockSubscriptionLink, status: string) {
  act(() => updates.simulateResult({ result: { data: { aiTaskUpdated: {
    ...comparisonTask(status), taskType: 'ANALYZE_GAPS', input: {}, pendingQuestions: [], acceptedAt: null, job: null,
  } } } }))
}

it('blocks a reloaded active comparison then enables direct writing after live completion', async () => {
  const user = userEvent.setup()
  const { router, updates } = renderLiveJob(job({ latestGapAnalysis: comparisonTask() }))
  expect(await screen.findByRole('button', { name: 'Write resume' })).toBeDisabled()
  await screen.findByText(/Comparing this job/)
  updateComparison(updates, 'COMPLETED')
  const write = await screen.findByRole('link', { name: 'Write resume' })
  expect(router.state.location.pathname).toBe('/jobs/job-1')
  await user.click(write)
  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs/job-1/resume/write'))
})

it('blocks writing from the card request through task failure and permits optional writing afterward', async () => {
  const user = userEvent.setup()
  const started = vi.fn(() => ({ data: { analyzeJobGaps: {
    __typename: 'AnalyzeJobGapsPayload', aiTask: comparisonTask(), errors: [],
  } } }))
  const { router, updates } = renderLiveJob(job(), [{
    request: { query: ANALYZE_JOB_GAPS_MUTATION, variables: { jobId: 'job-1' } }, delay: 150, result: started,
  }])
  await user.dblClick(await screen.findByRole('button', { name: 'Compare with my career library' }))
  expect(screen.getByRole('button', { name: 'Write resume' })).toBeDisabled()
  await screen.findByText(/Comparing this job/)
  expect(started).toHaveBeenCalledTimes(1)
  updateComparison(updates, 'FAILED')
  expect(await screen.findByText('Comparison unavailable')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Write resume' }))
  await user.click(screen.getByRole('button', { name: 'Write resume anyway' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/jobs/job-1/resume/write'))
})

it('keeps writing disabled when following an active comparison fails', async () => {
  const { updates } = renderLiveJob(job({ latestGapAnalysis: comparisonTask() }))
  expect(await screen.findByRole('button', { name: 'Write resume' })).toBeDisabled()
  act(() => updates.simulateResult({ error: new Error('Connection interrupted') }))
  expect(await screen.findByText('Connection interrupted')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Write resume' })).toBeDisabled()
})

it.each(['validation', 'network'])('enables writing and retry after a %s start failure', async kind => {
  const user = userEvent.setup()
  const failure = kind === 'validation'
    ? { result: { data: { analyzeJobGaps: { __typename: 'AnalyzeJobGapsPayload', aiTask: null, errors: ['Add career context first'] } } } }
    : { error: new Error('Offline') }
  renderLiveJob(job(), [
    { request: { query: ANALYZE_JOB_GAPS_MUTATION, variables: { jobId: 'job-1' } }, ...failure },
    { request: { query: ANALYZE_JOB_GAPS_MUTATION, variables: { jobId: 'job-1' } }, result: { data: {
      analyzeJobGaps: { __typename: 'AnalyzeJobGapsPayload', aiTask: comparisonTask(), errors: [] },
    } } },
  ])
  await user.click(await screen.findByRole('button', { name: 'Write resume' }))
  await user.click(screen.getByRole('button', { name: 'Compare first' }))
  expect(await screen.findByText(kind === 'validation' ? 'Add career context first' : /Couldn't reach the server/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Write resume' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Compare with my career library' }))
  await screen.findByText(/Comparing this job/)
  expect(screen.getByRole('button', { name: 'Write resume' })).toBeDisabled()
})

it('disables an already open dialog when the job gains an active comparison', async () => {
  const user = userEvent.setup()
  const { client, router } = renderLiveJob()
  await user.click(await screen.findByRole('button', { name: 'Write resume' }))
  act(() => client.cache.updateQuery({ query: JOB_QUERY, variables: { id: 'job-1' } }, existing => existing?.job ? {
    job: { ...existing.job, latestGapAnalysis: { ...comparisonTask(), __typename: 'AiTask' as const, status: 'QUEUED' as const } },
  } : existing))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Compare first' })).toBeDisabled())
  const write = screen.getByRole('button', { name: 'Write resume anyway' })
  expect(write).toBeDisabled()
  await user.click(write)
  expect(router.state.location.pathname).toBe('/jobs/job-1')
})

it('does not carry an active comparison into another job on the same route', async () => {
  const { router } = renderLiveJob(job({ latestGapAnalysis: comparisonTask() }), [{
    request: { query: JOB_QUERY, variables: { id: 'job-2' } }, result: { data: { job: job({ id: 'job-2', title: 'Other job' }) } },
  }])
  expect(await screen.findByRole('button', { name: 'Write resume' })).toBeDisabled()
  await act(() => router.navigate('/jobs/job-2'))
  await screen.findByRole('heading', { name: 'Other job' })
  expect(screen.getByRole('button', { name: 'Write resume' })).toBeEnabled()
  expect(screen.queryByText(/Comparing this job/)).not.toBeInTheDocument()
})

it('follows a newer comparison loaded after a locally started comparison completes', async () => {
  const user = userEvent.setup()
  const { router, updates, client } = renderLiveJob(job(), [{
    request: { query: ANALYZE_JOB_GAPS_MUTATION, variables: { jobId: 'job-1' } }, result: { data: {
      analyzeJobGaps: { __typename: 'AnalyzeJobGapsPayload', aiTask: comparisonTask(), errors: [] },
    } },
  }])
  await user.click(await screen.findByRole('button', { name: 'Compare with my career library' }))
  await screen.findByText(/Comparing this job/)
  updateComparison(updates, 'COMPLETED')
  await screen.findByRole('link', { name: 'Write resume' })
  const subscribed = vi.spyOn(updates, 'request')
  act(() => client.cache.updateQuery({ query: JOB_QUERY, variables: { id: 'job-1' } }, existing => existing?.job ? {
    job: { ...existing.job, latestGapAnalysis: {
      ...comparisonTask(), __typename: 'AiTask' as const, status: 'QUEUED' as const, id: 'task-2',
    } },
  } : existing))
  expect(await screen.findByRole('button', { name: 'Write resume' })).toBeDisabled()
  expect(screen.getByText(/Comparing this job/)).toBeInTheDocument()
  await waitFor(() => expect(subscribed.mock.calls.some(([operation]) => operation.variables.id === 'task-2')).toBe(true))
  act(() => updates.simulateResult({ result: { data: { aiTaskUpdated: {
    ...comparisonTask('COMPLETED'), id: 'task-2', taskType: 'ANALYZE_GAPS', input: {}, pendingQuestions: [], acceptedAt: null, job: null,
  } } } }))
  await screen.findByRole('link', { name: 'Write resume' })
  expect(router.state.location.pathname).toBe('/jobs/job-1')
})

it('shows Job Board import warnings on the returned saved job', async () => {
  renderWorkspace({
    historyState: { jobBoardImport: { jobId: 'job-1', warnings: ['The application link was omitted.'] } },
    mocks: [jobQuery(job())],
  })
  await screen.findByRole('heading', { name: 'Engineer' })
  expect(screen.getByText('Saved with a few changes')).toBeInTheDocument()
  expect(screen.getByText('The application link was omitted.')).toBeInTheDocument()
})

it.each([
  { jobId: 'another-job', warnings: ['Only for another job'] },
  { jobId: 'job-1', warnings: { unexpected: 'shape' } },
])('does not show unrelated or malformed import warnings: %j', async (jobBoardImport) => {
  renderWorkspace({
    historyState: { jobBoardImport }, mocks: [jobQuery(job())],
  })
  await screen.findByRole('heading', { name: 'Engineer' })
  expect(screen.queryByText('Saved with a few changes')).not.toBeInTheDocument()
})
