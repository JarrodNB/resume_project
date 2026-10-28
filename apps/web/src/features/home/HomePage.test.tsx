/** Checks Home's stage board and list, next-step signals, AI work in progress, and the first-run steps. */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'
import { CAREER_LIBRARY_QUERY } from '@/features/career-library/careerLibraryOperations'
import { JOB_PIPELINE_QUERY, RUNNING_AI_TASKS_QUERY } from './homeOperations'
import { HomePage } from './HomePage'
import { ARCHIVE_JOB_MUTATION } from '@/features/jobs/jobsOperations'

afterEach(() => localStorage.clear())

function entry(id: string, title: string, stage: string, nextStep: string) {
  return { __typename: 'JobPipelineEntry' as const, nextStep, job: { __typename: 'Job' as const, id, title, company: 'Synthetic Co', location: 'Remote', stage } }
}

const pipeline = [
  entry('job-1', 'Platform Engineer', 'UNAPPLIED', 'WRITE_RESUME'),
  entry('job-2', 'Data Analyst', 'UNAPPLIED', 'RESUME_RUNNING'),
  entry('job-3', 'Site Reliability Engineer', 'APPLIED', 'AWAITING_RESPONSE'),
  entry('job-4', 'Backend Developer', 'INTERVIEWING', 'PRACTICE_INTERVIEW'),
  entry('job-5', 'QA Lead', 'REJECTED', 'NONE'),
]

function runningTask(id: string, label: string, destination: string) {
  return { __typename: 'RunningAiTask' as const, id, label, destination }
}

function runningMock(runningAiTasks: unknown[]) {
  return { request: { query: RUNNING_AI_TASKS_QUERY }, result: { data: { runningAiTasks } } }
}

function taskUpdate(id: string, status: string) {
  return { request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id } }, result: { data: { aiTaskUpdated: {
    __typename: 'AiTask' as const, id, taskType: 'TAILOR_RESUME', status, result: null, input: {}, pendingQuestions: [],
    errorMessage: null, acceptedAt: null, createdAt: '2026-10-01T00:00:00Z', job: null,
  } } } }
}

function libraryMock(skills: unknown[]) {
  const me = { __typename: 'User' as const, id: 'user-1', name: 'Jane', contactEmail: null, phone: null, location: null, links: [], summary: null }
  return { request: { query: CAREER_LIBRARY_QUERY }, result: { data: { me, experiences: [], projects: [], educations: [], certifications: [], skills, careerContexts: [] } } }
}

function renderHome(jobPipeline: unknown[], runningAiTasks: unknown[] = [], skills: unknown[] = [{ __typename: 'Skill', id: 'skill-1', name: 'Ruby', category: null, position: 1 }]) {
  return renderPage({ path: '/', url: '/', element: <HomePage />, mocks: [
    { request: { query: JOB_PIPELINE_QUERY }, result: { data: { jobPipeline } } },
    runningMock(runningAiTasks),
    libraryMock(skills),
  ] })
}

it('groups jobs by stage on a board, each linking its next step to the right job tab', async () => {
  renderHome(pipeline)
  const notApplied = await screen.findByRole('region', { name: /Not applied/ })
  expect(within(notApplied).getByRole('link', { name: 'Platform Engineer' })).toHaveAttribute('href', '/jobs/job-1')
  expect(within(notApplied).getByRole('link', { name: 'Write resume: Platform Engineer' })).toHaveAttribute('href', '/jobs/job-1/resume')
  const interviewing = screen.getByRole('region', { name: /Interviewing/ })
  expect(within(interviewing).getByRole('link', { name: 'Practise interview: Backend Developer' })).toHaveAttribute('href', '/jobs/job-4/interview')
  const applied = screen.getByRole('region', { name: /^Applied/ })
  expect(within(applied).getByText('Waiting to hear back')).toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: /Offer/ })).getByText('No jobs')).toBeInTheDocument()
  expect(screen.getByText('5 saved jobs')).toBeInTheDocument()
})

it('lists every kind of running AI work in the strip, each linked to its page', async () => {
  renderHome(pipeline, [
    runningTask('task-1', 'Resume draft: Data Analyst', '/jobs/job-2/resume'),
    runningTask('task-2', 'Resume import', '/library/import/task-2'),
  ])
  const running = await screen.findByRole('region', { name: 'AI work in progress' })
  expect(await within(running).findByRole('link', { name: 'Resume draft: Data Analyst' })).toHaveAttribute('href', '/jobs/job-2/resume')
  expect(within(running).getByRole('link', { name: 'Resume import' })).toHaveAttribute('href', '/library/import/task-2')
  expect(within(running).queryByText('Platform Engineer')).not.toBeInTheDocument()
})

it('reloads the strip and the board when a running task reports it finished, without polling', async () => {
  renderPage({ path: '/', url: '/', element: <HomePage />, mocks: [
    { request: { query: JOB_PIPELINE_QUERY }, result: { data: { jobPipeline: [entry('job-2', 'Data Analyst', 'UNAPPLIED', 'RESUME_RUNNING')] } } },
    runningMock([runningTask('task-1', 'Resume draft: Data Analyst', '/jobs/job-2/resume')]),
    taskUpdate('task-1', 'COMPLETED'),
    runningMock([]),
    { request: { query: JOB_PIPELINE_QUERY }, result: { data: { jobPipeline: [entry('job-2', 'Data Analyst', 'UNAPPLIED', 'REVIEW_RESUME_DRAFT')] } } },
  ] })
  const running = await screen.findByRole('region', { name: 'AI work in progress' })
  expect(await within(running).findByText('Nothing running right now')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('link', { name: 'Review resume draft: Data Analyst' })).toBeInTheDocument())
})

it('switches to a list that skips empty stages, and remembers the choice', async () => {
  const user = userEvent.setup()
  const { unmount } = renderHome(pipeline)
  await screen.findByRole('region', { name: /Not applied/ })
  await user.click(screen.getByRole('button', { name: 'List' }))
  expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('region', { name: /Offer/ })).not.toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: /Rejected/ })).getByRole('link', { name: 'QA Lead' })).toBeInTheDocument()
  unmount()
  renderHome(pipeline)
  expect(await screen.findByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
})

it('shows the three starting steps before any job is saved', async () => {
  renderHome([], [], [])
  const firstRun = await screen.findByRole('region', { name: 'Start your search in three steps' })
  expect(within(firstRun).getByRole('link', { name: 'Import a resume' })).toHaveAttribute('href', '/library/import')
  expect(within(firstRun).getByRole('link', { name: 'Find jobs' })).toHaveAttribute('href', '/jobs/find')
  expect(screen.queryByRole('group', { name: 'Show jobs as' })).not.toBeInTheDocument()
})

it('marks the library step done and points at saving a job once the library has content', async () => {
  renderHome([])
  const firstRun = await screen.findByRole('region', { name: 'Start your search in three steps' })
  expect(await within(firstRun).findByRole('link', { name: 'Review your library' })).toHaveAttribute('href', '/library')
  expect(within(firstRun).queryByRole('link', { name: 'Import a resume' })).not.toBeInTheDocument()
  expect(within(firstRun).getByRole('heading', { name: 'Save a job you want' }).closest('li')).toHaveAttribute('aria-current', 'step')
})

it('keeps the import step current while the library is empty', async () => {
  renderHome([], [], [])
  const firstRun = await screen.findByRole('region', { name: 'Start your search in three steps' })
  expect(await within(firstRun).findByRole('link', { name: 'Import a resume' })).toBeInTheDocument()
  expect(within(firstRun).getByRole('heading', { name: 'Fill your career library' }).closest('li')).toHaveAttribute('aria-current', 'step')
})

it('tells a user with saved jobs and an empty library to fill the library first', async () => {
  renderHome(pipeline, [], [])
  const note = await screen.findByRole('complementary', { name: 'Your career library is empty' })
  expect(within(note).getByRole('link', { name: 'Import a resume' })).toHaveAttribute('href', '/library/import')
})

it('explains a load failure and offers to try again', async () => {
  renderPage({ path: '/', url: '/', element: <HomePage />, mocks: [{ request: { query: JOB_PIPELINE_QUERY }, error: new Error('Network down') }, runningMock([])] })
  expect(await screen.findByText("Couldn't load your jobs")).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
})

it('marks an offer in green words and says when no AI work is running', async () => {
  renderHome([entry('job-6', 'Analytics Engineer', 'OFFER', 'NONE')])
  const offer = await screen.findByRole('region', { name: /^Offer/ })
  expect(within(offer).getByText('Offer received')).toBeInTheDocument()
  expect(await within(screen.getByRole('region', { name: 'AI work in progress' })).findByText('Nothing running right now')).toBeInTheDocument()
  expect(within(screen.getByRole('list', { name: 'Signal colors' })).getByText('Needs you')).toBeInTheDocument()
})

it('lets every board tile be dragged to another stage, but not list rows', async () => {
  const user = userEvent.setup()
  renderHome(pipeline)
  const notApplied = await screen.findByRole('region', { name: /Not applied/ })
  expect(within(notApplied).getByRole('group', { name: 'Platform Engineer at Synthetic Co, draggable' })).toBeInTheDocument()
  expect(within(notApplied).getByRole('link', { name: 'Platform Engineer' })).toBeInTheDocument()
  expect(screen.getAllByRole('group', { name: /, draggable$/ })).toHaveLength(pipeline.length)
  await user.click(screen.getByRole('button', { name: 'List' }))
  expect(screen.queryByRole('group', { name: /, draggable$/ })).not.toBeInTheDocument()
})

for (const view of ['Board', 'List']) {
  it(`archives a job from Home's ${view.toLowerCase()} after confirmation and updates the saved count`, async () => {
    const user = userEvent.setup()
    renderPage({ path: '/', url: '/', element: <HomePage />, mocks: [
      { request: { query: JOB_PIPELINE_QUERY }, result: { data: { jobPipeline: pipeline } } },
      runningMock([]), libraryMock([]),
      {
        request: { query: ARCHIVE_JOB_MUTATION, variables: { id: 'job-1' } },
        result: { data: { archiveJob: { __typename: 'ArchiveJobPayload', errors: [] } } },
      },
    ] })
    await screen.findByText('5 saved jobs')
    await user.click(screen.getByRole('button', { name: view, exact: true }))
    await user.click(screen.getByRole('button', { name: 'Archive Platform Engineer' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Your answers, resumes, and interview history are kept.')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('link', { name: 'Platform Engineer', exact: true })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Archive Platform Engineer' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive', exact: true }))
    expect(await screen.findByText('4 saved jobs')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Platform Engineer', exact: true })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Data Analyst', exact: true })).toBeVisible()
  })
}

it('keeps a Home tile visible when archiving fails', async () => {
  const user = userEvent.setup()
  renderPage({ path: '/', url: '/', element: <HomePage />, mocks: [
    { request: { query: JOB_PIPELINE_QUERY }, result: { data: { jobPipeline: pipeline } } },
    runningMock([]), libraryMock([]),
    {
      request: { query: ARCHIVE_JOB_MUTATION, variables: { id: 'job-1' } },
      result: { data: { archiveJob: { __typename: 'ArchiveJobPayload', errors: ['Archive unavailable'] } } },
    },
  ] })
  await user.click(await screen.findByRole('button', { name: 'Archive Platform Engineer' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive', exact: true }))
  expect(await screen.findByText('Archive unavailable')).toBeVisible()
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
  expect(screen.getByText('5 saved jobs')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Platform Engineer', exact: true })).toBeInTheDocument()
})
