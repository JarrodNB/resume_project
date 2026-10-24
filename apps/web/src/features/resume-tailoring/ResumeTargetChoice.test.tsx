/** The server gate controls target choices before generation starts. */
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { TailorResumePage } from './TailorResumePage'
import { TAILOR_JOB_QUERY, START_RESUME_TAILORING_MUTATION } from './tailorOperations'
vi.mock('@/features/ai-tasks/useAiTaskUpdates', () => ({ useAiTaskUpdates: () => ({ aiTask: null, error: null }) }))
vi.mock('./ResumePdfPreview', () => ({ ResumePdfPreview: () => null }))
function jobMock(eligible: boolean, latestTailoring: object | null = null) {
  return { request: { query: TAILOR_JOB_QUERY, variables: { id: 'job-1' } }, result: { data: { resumeTwoPageEligible: eligible, job: { __typename: 'Job', id: 'job-1', title: 'Engineer', company: 'Acme', resume: null, latestTailoring } } } }
}
function render(mocks: Parameters<typeof renderPage>[0]['mocks']) {
  return renderPage({ path: '/jobs/:id/tailor', url: '/jobs/job-1/tailor', element: <TailorResumePage />, mocks })
}
const queued = { data: { startResumeTailoring: { __typename: 'StartResumeTailoringPayload', aiTask: { __typename: 'AiTask', id: 'task-1', status: 'QUEUED', input: { target_pages: 1 } }, errors: [] } } }
it('waits for a choice and sends two pages only after the server offers it', async () => {
  const user = userEvent.setup()
  const start = vi.fn(() => ({ data: { startResumeTailoring: { ...queued.data.startResumeTailoring, aiTask: { ...queued.data.startResumeTailoring.aiTask, input: { target_pages: 2 } } } } }))
  render([jobMock(true), { request: { query: START_RESUME_TAILORING_MUTATION, variables: { jobId: 'job-1', targetPages: 2 } }, result: start }])
  expect(await screen.findByRole('radio', { name: 'One page' })).toBeChecked()
  expect(start).not.toHaveBeenCalled()
  await user.click(screen.getByRole('radio', { name: 'Two pages' }))
  await user.click(screen.getByRole('button', { name: 'Write my resume' }))
  expect(await screen.findByText('Writing your complete draft…')).toBeInTheDocument()
  expect(start).toHaveBeenCalledOnce()
})
it('offers only one page below the server gate', async () => {
  const user = userEvent.setup()
  render([jobMock(false), { request: { query: START_RESUME_TAILORING_MUTATION, variables: { jobId: 'job-1', targetPages: 1 } }, result: queued }])
  expect(await screen.findByRole('radio', { name: 'One page' })).toBeChecked()
  expect(screen.queryByRole('radio', { name: 'Two pages' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Write my resume' }))
  expect(await screen.findByText('Writing your complete draft…')).toBeInTheDocument()
})
it('keeps the target available when eligibility changed before task start', async () => {
  const user = userEvent.setup()
  render([jobMock(true), { request: { query: START_RESUME_TAILORING_MUTATION, variables: { jobId: 'job-1', targetPages: 2 } }, result: { data: { startResumeTailoring: { __typename: 'StartResumeTailoringPayload', aiTask: null, errors: ['Two pages need at least 700 words.'] } } } }])
  await user.click(await screen.findByRole('radio', { name: 'Two pages' }))
  await user.click(screen.getByRole('button', { name: 'Write my resume' }))
  expect(await screen.findByText('Two pages need at least 700 words.')).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'Two pages' })).toBeChecked()
})
it('restores queued work without offering to start a duplicate', async () => {
  render([jobMock(false, { __typename: 'AiTask', id: 'task-1', status: 'QUEUED', input: { target_pages: 2 }, result: null, acceptedAt: null, errorMessage: null })])
  expect(await screen.findByText('Writing your complete draft…')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Write my resume' })).not.toBeInTheDocument()
  expect(screen.getByText('Target: two pages')).toBeInTheDocument()
})
