/** The saved-resume route opens the same Markdown editor and handles orphan resumes. */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { ResumePage } from './ResumePage'
import { DELETE_RESUME_MUTATION, RESUME_QUERY } from './resumesOperations'
import { UPDATE_RESUME_MUTATION } from '@/features/resume-tailoring/tailorOperations'
import { downloadResumePdf, downloadResumeDocx } from '@/features/resume-tailoring/resumeDownload'

vi.mock('@/features/resume-tailoring/resumeDownload', () => ({ downloadResumePdf: vi.fn().mockResolvedValue(undefined), downloadResumeDocx: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/features/resume-tailoring/ResumePdfPreview', () => ({ ResumePdfPreview: ({ model }: { model: string }) => <pre data-testid="pdf-model">{model}</pre> }))
const markdown = '# Ada\n\nBackend engineer.'
const revised = '# Ada\n\nBackend engineer and writer.'
function resumeQuery(job: object | null) {
  return { request: { query: RESUME_QUERY, variables: { id: 'resume-1' } }, result: { data: { resume: { __typename: 'Resume', id: 'resume-1', title: 'Engineer at Acme', job, markdown, targetPages: 1 } } } }
}
function render(mocks: Parameters<typeof renderPage>[0]['mocks'], historyState?: object) {
  return renderPage({ path: '/resumes/:id', url: '/resumes/resume-1', element: <ResumePage />, historyState, mocks, extraRoutes: [{ path: '/resumes', element: <p>Resume list</p> }] })
}

it('opens a saved Markdown resume with its job breadcrumb and edits it', async () => {
  const user = userEvent.setup()
  const job = { __typename: 'Job', id: 'job-1', title: 'Engineer', company: 'Acme' }
  render([resumeQuery(job), { request: { query: UPDATE_RESUME_MUTATION, variables: { id: 'resume-1', markdown: revised } }, result: { data: { updateResume: { __typename: 'UpdateResumePayload', resume: { __typename: 'Resume', id: 'resume-1', title: 'Engineer at Acme', markdown: revised, targetPages: 1 }, errors: [] } } } }], { fromJobId: 'job-1' })
  expect(await screen.findByRole('link', { name: 'Back to job' })).toHaveAttribute('href', '/jobs/job-1')
  const input = screen.getByRole('textbox', { name: 'Resume Markdown' })
  expect(input).toHaveValue(markdown)
  fireEvent.change(input, { target: { value: revised } })
  await user.click(screen.getByRole('button', { name: 'Preview' }))
  expect(screen.getByTestId('pdf-model')).toHaveTextContent('Backend engineer and writer.')
  await user.click(screen.getByRole('button', { name: 'Close' }))
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled())
})

it('keeps an orphan resume editable and exports its saved Markdown', async () => {
  const user = userEvent.setup()
  render([resumeQuery(null)])
  expect(await screen.findByText('The job for this resume was removed.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Download PDF' }))
  expect(downloadResumePdf).toHaveBeenLastCalledWith(markdown, 'Engineer at Acme')
  await user.click(screen.getByRole('button', { name: 'Download DOCX' }))
  expect(downloadResumeDocx).toHaveBeenLastCalledWith(markdown, 'Engineer at Acme')
})

it('deletes an orphan resume and returns to the list', async () => {
  const user = userEvent.setup()
  const deleted = vi.fn(() => ({ data: { deleteResume: { __typename: 'DeleteResumePayload', resume: { __typename: 'Resume', id: 'resume-1' }, errors: [] } } }))
  const { router } = render([resumeQuery(null), { request: { query: DELETE_RESUME_MUTATION, variables: { id: 'resume-1' } }, result: deleted }])
  await user.click(await screen.findByRole('button', { name: 'Delete resume' }))
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/resumes'))
  expect(deleted).toHaveBeenCalledOnce()
})
