/** Follow a new-format task from completion through save and edit at the job route. */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'
import { TailorResumePage } from './TailorResumePage'
import { SAVE_TAILORED_RESUME_MUTATION, START_RESUME_TAILORING_MUTATION, TAILOR_JOB_QUERY, UPDATE_RESUME_MUTATION } from './tailorOperations'

vi.mock('./ResumePdfPreview', () => ({ ResumePdfPreview: ({ model }: { model: string }) => <pre data-testid="pdf-model">{model}</pre> }))
const markdown = '# Ada\n\nBackend engineer.'
const edited = '# Ada\n\nBackend engineer and writer.'
const completedTask = { __typename: 'AiTask', id: 'task-1', status: 'COMPLETED', acceptedAt: null, input: { target_pages: 1 }, result: { markdown, target_pages: 1, warnings: [] }, errorMessage: null }
function jobMock(task: object | null, resume: object | null = null) {
  return { request: { query: TAILOR_JOB_QUERY, variables: { id: 'job-1' } }, result: { data: { resumeTwoPageEligible: false, job: { __typename: 'Job', id: 'job-1', title: 'Engineer', company: 'Acme', latestTailoring: task, resume } } } }
}
function render(mocks: Parameters<typeof renderPage>[0]['mocks']) {
  return renderPage({ path: '/jobs/:id/tailor', url: '/jobs/job-1/tailor', element: <TailorResumePage />, mocks })
}

it('shows a restored failed task and lets the user retry', async () => {
  const user = userEvent.setup()
  render([
    jobMock({ ...completedTask, status: 'FAILED', result: null, errorMessage: 'Generation timed out.' }),
    { request: { query: START_RESUME_TAILORING_MUTATION, variables: { jobId: 'job-1', targetPages: 1 } }, result: { data: { startResumeTailoring: { __typename: 'StartResumeTailoringPayload', aiTask: { __typename: 'AiTask', id: 'retry-task', status: 'QUEUED', input: { target_pages: 1 } }, errors: [] } } } },
    { request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: 'retry-task' } }, delay: Infinity },
  ])
  expect(await screen.findByText('Generation timed out.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Writing your complete draft…')).toBeInTheDocument()
})

it('saves a completed Markdown task and opens the saved editor', async () => {
  const user = userEvent.setup()
  render([
    jobMock(completedTask),
    { request: { query: SAVE_TAILORED_RESUME_MUTATION, variables: { aiTaskId: 'task-1', markdown } }, result: { data: { saveTailoredResume: { __typename: 'SaveTailoredResumePayload', resume: { __typename: 'Resume', id: 'resume-1', title: 'Engineer at Acme' }, errors: [] } } } },
    jobMock(null, { __typename: 'Resume', id: 'resume-1', title: 'Engineer at Acme', markdown, targetPages: 1 }),
  ])
  expect(await screen.findByRole('textbox', { name: 'Resume Markdown' })).toHaveValue(markdown)
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  expect(await screen.findByRole('heading', { name: 'Engineer at Acme' })).toBeInTheDocument()
})

it('edits a saved Markdown resume and previews current unsaved text', async () => {
  const user = userEvent.setup()
  render([
    jobMock(null, { __typename: 'Resume', id: 'resume-1', title: 'Engineer at Acme', markdown, targetPages: 1 }),
    { request: { query: UPDATE_RESUME_MUTATION, variables: { id: 'resume-1', markdown: edited } }, result: { data: { updateResume: { __typename: 'UpdateResumePayload', resume: { __typename: 'Resume', id: 'resume-1', title: 'Engineer at Acme', markdown: edited, targetPages: 1 }, errors: [] } } } },
  ])
  const input = await screen.findByRole('textbox', { name: 'Resume Markdown' })
  fireEvent.change(input, { target: { value: edited } })
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Preview' }))
  expect(screen.getByTestId('pdf-model')).toHaveTextContent('Backend engineer and writer.')
  await user.click(screen.getByRole('button', { name: 'Close' }))
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled())
})

it('does not restore a completed legacy task and waits for a new target choice', async () => {
  const user = userEvent.setup()
  render([
    jobMock({ ...completedTask, result: { sections: [{ section_type: 'summary', content: { text: 'Old' } }] } }),
    { request: { query: START_RESUME_TAILORING_MUTATION, variables: { jobId: 'job-1', targetPages: 1 } }, result: { data: { startResumeTailoring: { __typename: 'StartResumeTailoringPayload', aiTask: { __typename: 'AiTask', id: 'task-2', status: 'QUEUED', input: { target_pages: 1 } }, errors: [] } } } },
    { request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: 'task-2' } }, delay: Infinity },
  ])
  await user.click(await screen.findByRole('button', { name: 'Write my resume' }))
  expect(await screen.findByText('Writing your complete draft…')).toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: 'Resume Markdown' })).not.toBeInTheDocument()
})

it('restores a queued task and displays its live completed Markdown without starting another task', async () => {
  render([
    jobMock({ ...completedTask, status: 'QUEUED', result: null }),
    { request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id: 'task-1' } }, result: { data: { aiTaskUpdated: { ...completedTask, taskType: 'TAILOR_RESUME', input: {}, pendingQuestions: null, createdAt: '2026-10-24T00:00:00Z', job: { __typename: 'Job', id: 'job-1' } } } } },
  ])
  expect(await screen.findByRole('textbox', { name: 'Resume Markdown' })).toHaveValue(markdown)
  expect(screen.queryByText("Couldn't follow the resume")).not.toBeInTheDocument()
})
