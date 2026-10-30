/**
 * Description: Submitting a job link starts scraping and opens the task page; errors are shown.
 */
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { AddJobFromUrlPage } from './AddJobFromUrlPage'
import { SCRAPE_JOB_MUTATION } from './jobsOperations'

const URL = 'https://company.com/careers/engineer?jobId=42'

function scrapeJobMock(payload: Record<string, unknown>) {
  return {
    request: { query: SCRAPE_JOB_MUTATION, variables: { url: URL } },
    result: { data: { scrapeJob: { __typename: 'ScrapeJobPayload', aiTask: null, errors: [], ...payload } } },
  }
}

function renderAddJobPage(mocks: ReturnType<typeof scrapeJobMock>[]) {
  return renderPage({
    path: '/jobs/new',
    url: '/jobs/new',
    element: <AddJobFromUrlPage />,
    mocks,
    extraRoutes: [{ path: '/jobs/new/:aiTaskId', element: <p>Task page</p> }],
  })
}

it('starts scraping and opens the task page', async () => {
  const { router } = renderAddJobPage([
    scrapeJobMock({ aiTask: { __typename: 'AiTask', id: 'task-1', status: 'QUEUED' } }),
  ])

  await userEvent.type(screen.getByLabelText('Link'), URL)
  await userEvent.click(screen.getByRole('button', { name: 'Add job' }))

  expect(await screen.findByText('Task page')).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/jobs/new/task-1')
})

it('shows why a link was rejected', async () => {
  renderAddJobPage([scrapeJobMock({ errors: ['You already saved this job'] })])

  await userEvent.type(screen.getByLabelText('Link'), URL)
  await userEvent.click(screen.getByRole('button', { name: 'Add job' }))

  expect(await screen.findByText('You already saved this job')).toBeInTheDocument()
})
