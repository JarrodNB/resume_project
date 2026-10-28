/** Checks Home's stage board and list, next-step signals, AI work in progress, and the first-run steps. */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'
import { JOB_PIPELINE_QUERY, RUNNING_AI_TASKS_QUERY } from './homeOperations'
import { HomePage } from './HomePage'

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

function renderHome(jobPipeline: unknown[], runningAiTasks: unknown[] = []) {
  return renderPage({ path: '/', url: '/', element: <HomePage />, mocks: [
    { request: { query: JOB_PIPELINE_QUERY }, result: { data: { jobPipeline } } },
    runningMock(runningAiTasks),
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
  renderHome([])
  const firstRun = await screen.findByRole('region', { name: 'Start your search in three steps' })
  expect(within(firstRun).getByRole('link', { name: 'Import a resume' })).toHaveAttribute('href', '/library/import')
  expect(within(firstRun).getByRole('link', { name: 'Find jobs' })).toHaveAttribute('href', '/jobs/find')
  expect(screen.queryByRole('group', { name: 'Show jobs as' })).not.toBeInTheDocument()
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

it('gives every board tile a grip to drag it to another stage, but not list rows', async () => {
  const user = userEvent.setup()
  renderHome(pipeline)
  const notApplied = await screen.findByRole('region', { name: /Not applied/ })
  expect(within(notApplied).getByRole('button', { name: 'Drag Platform Engineer at Synthetic Co' })).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /^Drag / })).toHaveLength(pipeline.length)
  await user.click(screen.getByRole('button', { name: 'List' }))
  expect(screen.queryByRole('button', { name: /^Drag / })).not.toBeInTheDocument()
})
