/**
 * Description: Submitting a pasted job ad starts parsing and opens the task page; errors are shown.
 */
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { AddJobFromTextPage } from './AddJobFromTextPage'
import { PARSE_JOB_POSTING_MUTATION } from './jobsOperations'

const AD = 'AI Engineer at Acme. Required: Python.'

function parseJobMock(payload: Record<string, unknown>) {
  return {
    request: { query: PARSE_JOB_POSTING_MUTATION, variables: { text: AD } },
    result: {
      data: { parseJobPosting: { __typename: 'ParseJobPostingPayload', aiTask: null, errors: [], errorCode: null, ...payload } },
    },
  }
}

function renderPastePage(mocks: ReturnType<typeof parseJobMock>[]) {
  return renderPage({
    path: '/jobs/paste',
    url: '/jobs/paste',
    element: <AddJobFromTextPage />,
    mocks,
    extraRoutes: [{ path: '/jobs/paste/:aiTaskId', element: <p>Task page</p> }],
  })
}

it('starts parsing and opens the task page', async () => {
  const { router } = renderPastePage([
    parseJobMock({ aiTask: { __typename: 'AiTask', id: 'task-1', status: 'QUEUED' } }),
  ])

  await userEvent.type(screen.getByLabelText('Job ad'), AD)
  await userEvent.click(screen.getByRole('button', { name: 'Add job' }))

  expect(await screen.findByText('Task page')).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/jobs/paste/task-1')
})

it('shows why a paste was rejected', async () => {
  renderPastePage([parseJobMock({ errors: ['This job ad is too long. Shorten it and try again.'] })])

  await userEvent.type(screen.getByLabelText('Job ad'), AD)
  await userEvent.click(screen.getByRole('button', { name: 'Add job' }))

  expect(await screen.findByText('This job ad is too long. Shorten it and try again.')).toBeInTheDocument()
})

it('links to Plan & billing when the paste is refused because the trial ended', async () => {
  renderPastePage([parseJobMock({ errors: ['Trial over.'], errorCode: 'PLAN_ENDED' })])

  await userEvent.type(screen.getByLabelText('Job ad'), AD)
  await userEvent.click(screen.getByRole('button', { name: 'Add job' }))

  expect(await screen.findByText('Trial over.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Plan & billing' })).toHaveAttribute('href', '/account/billing')
})

it('adds no billing link to other rejections', async () => {
  renderPastePage([parseJobMock({ errors: ['Too long.'] })])

  await userEvent.type(screen.getByLabelText('Job ad'), AD)
  await userEvent.click(screen.getByRole('button', { name: 'Add job' }))

  await screen.findByText('Too long.')
  expect(screen.queryByRole('link', { name: 'Plan & billing' })).not.toBeInTheDocument()
})

it('stays on the form when the ad is empty', async () => {
  const { router } = renderPastePage([])

  expect(screen.getByRole('button', { name: 'Add job' })).toBeDisabled()
  expect(router.state.location.pathname).toBe('/jobs/paste')
})

it('offers adding the job from its posting link instead', () => {
  renderPastePage([])
  expect(screen.getByRole('link', { name: 'Add it from the link' })).toHaveAttribute('href', '/jobs/new')
})
