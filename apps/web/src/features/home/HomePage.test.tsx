/** Checks Home's stage board and list, next-step signals, AI work in progress, and the first-run steps. */
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { JOB_PIPELINE_QUERY } from './homeOperations'
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

function renderHome(jobPipeline: unknown[]) {
  return renderPage({ path: '/', url: '/', element: <HomePage />, mocks: [{ request: { query: JOB_PIPELINE_QUERY }, result: { data: { jobPipeline } } }] })
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

it('lists AI work in progress above the board', async () => {
  renderHome(pipeline)
  const running = await screen.findByRole('region', { name: 'AI work in progress' })
  expect(within(running).getByText('Data Analyst')).toBeInTheDocument()
  expect(within(running).getByRole('link', { name: 'Writing resume draft: Data Analyst' })).toHaveAttribute('href', '/jobs/job-2/resume')
  expect(within(running).queryByText('Platform Engineer')).not.toBeInTheDocument()
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
  renderPage({ path: '/', url: '/', element: <HomePage />, mocks: [{ request: { query: JOB_PIPELINE_QUERY }, error: new Error('Network down') }] })
  expect(await screen.findByText("Couldn't load your jobs")).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
})

it('marks an offer in green words and says when no AI work is running', async () => {
  renderHome([entry('job-6', 'Analytics Engineer', 'OFFER', 'NONE')])
  const offer = await screen.findByRole('region', { name: /^Offer/ })
  expect(within(offer).getByText('Offer received')).toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: 'AI work in progress' })).getByText('Nothing running right now')).toBeInTheDocument()
  expect(within(screen.getByRole('list', { name: 'Signal colors' })).getByText('Needs you')).toBeInTheDocument()
})
