/**
 * Description: The paste task page shows progress and failures, opens the saved job, and shows
 * warnings first when there are any.
 */
import { screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'
import { renderPage } from '@/test/renderPage'
import { JobPasteTaskPage } from './JobPasteTaskPage'

function aiTaskMock(task: Record<string, unknown>) {
  return {
    request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: 'task-1' } },
    result: {
      data: {
        aiTaskUpdated: {
          __typename: 'AiTask',
          id: 'task-1',
          taskType: 'PARSE_JOB_POSTING',
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
    path: '/jobs/paste/:aiTaskId',
    url: '/jobs/paste/task-1',
    element: <JobPasteTaskPage />,
    mocks: [aiTaskMock(task)],
    extraRoutes: [{ path: '/jobs/:id', element: <p>Job page</p> }],
  })
}

it('shows progress while the ad is read', async () => {
  renderTaskPage({ status: 'QUEUED' })
  expect(await screen.findByText('Reading the job ad…')).toBeInTheDocument()
})

it('shows the error when parsing failed', async () => {
  renderTaskPage({
    status: 'FAILED',
    errorMessage: "We couldn't find a job title and company in that text. Paste the full ad, or add the job manually.",
  })

  expect(await screen.findByText(/couldn't find a job title and company/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Try another ad' })).toHaveAttribute('href', '/jobs/paste')
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
