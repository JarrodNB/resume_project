/**
 * Description: The scrape task page shows progress and failures, opens the saved job, and shows the
 * scraper's warnings first when there are any.
 */
import { screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'
import { renderPage } from '@/test/renderPage'
import { JobScrapeTaskPage } from './JobScrapeTaskPage'

function aiTaskMock(task: Record<string, unknown>) {
  return {
    request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: 'task-1' } },
    result: {
      data: {
        aiTaskUpdated: {
          __typename: 'AiTask',
          id: 'task-1',
          taskType: 'SCRAPE_JOB',
          status: 'QUEUED',
          result: null,
          input: {},
          pendingQuestions: [],
          errorMessage: null,
          acceptedAt: null,
          createdAt: '2026-10-01T00:00:00Z',
          job: null,
          ...task,
        },
      },
    },
  }
}

function renderTaskPage(task: Record<string, unknown>) {
  return renderPage({
    path: '/jobs/new/:aiTaskId',
    url: '/jobs/new/task-1',
    element: <JobScrapeTaskPage />,
    mocks: [aiTaskMock(task)],
    extraRoutes: [{ path: '/jobs/:id', element: <p>Job page</p> }],
  })
}

it('shows progress while the posting is read', async () => {
  renderTaskPage({ status: 'QUEUED' })
  expect(await screen.findByText('Reading the job posting…')).toBeInTheDocument()
})

it('shows the error when scraping failed', async () => {
  renderTaskPage({ status: 'FAILED', errorMessage: 'We couldn’t find this job posting. It may have closed.' })

  expect(await screen.findByText('We couldn’t find this job posting. It may have closed.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Try another link' })).toHaveAttribute('href', '/jobs/new')
})

it('opens the saved job when there are no warnings', async () => {
  const { router } = renderTaskPage({
    status: 'COMPLETED',
    result: { scraped_job: { warnings: [] } },
    job: { __typename: 'Job', id: 'job-1' },
  })

  expect(await screen.findByText('Job page')).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/jobs/job-1')
})

it('shows warnings before opening the job', async () => {
  renderTaskPage({
    status: 'COMPLETED',
    result: { scraped_job: { warnings: ['AI sorted the requirements. Check them.'] } },
    job: { __typename: 'Job', id: 'job-1' },
  })

  expect(await screen.findByText('AI sorted the requirements. Check them.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'View job' })).toHaveAttribute('href', '/jobs/job-1')
})
