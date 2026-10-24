/** The saved Markdown editor previews edits and exports only successful saves. */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { downloadResumePdf, downloadResumeDocx } from './resumeDownload'
import { SavedResumeEditor } from './SavedResumeEditor'
import { UPDATE_RESUME_MUTATION } from './tailorOperations'

vi.mock('./resumeDownload', () => ({ downloadResumePdf: vi.fn().mockResolvedValue(undefined), downloadResumeDocx: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./ResumePdfPreview', () => ({ ResumePdfPreview: ({ model }: { model: string }) => <pre data-testid="pdf-model">{model}</pre> }))
const original = '# Ada\n\nOriginal summary.'
const revised = '# Ada\n\nRevised summary.'
function updateMock(markdown: string, errors: string[] = []) {
  return { request: { query: UPDATE_RESUME_MUTATION, variables: { id: 'resume-1', markdown } }, result: { data: { updateResume: { __typename: 'UpdateResumePayload', errors, resume: errors.length ? null : { __typename: 'Resume', id: 'resume-1', title: 'Engineer', markdown, targetPages: 1 } } } } }
}
function renderEditor(mocks: ReturnType<typeof updateMock>[] = []) {
  return renderPage({ path: '/', url: '/', mocks, element: <><SavedResumeEditor resumeId="resume-1" title="Engineer" markdown={original} onDeleted={vi.fn()} /><Link to="/jobs">Jobs</Link></>, extraRoutes: [{ path: '/jobs', element: <p>Job list</p> }] })
}

it('previews unsaved edits, warns before leaving, and unlocks exports after saving', async () => {
  const user = userEvent.setup()
  renderEditor([updateMock(revised)])
  const input = screen.getByRole('textbox', { name: 'Resume Markdown' })
  await user.clear(input)
  fireEvent.change(input, { target: { value: revised } })
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Download DOCX' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Preview' }))
  expect(screen.getByTestId('pdf-model')).toHaveTextContent('Revised summary.')
  await user.click(screen.getByRole('button', { name: 'Close' }))
  await user.click(screen.getByRole('link', { name: 'Jobs' }))
  expect(screen.getByRole('dialog', { name: 'Leave without saving?' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Keep editing' }))
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('All changes saved'))
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled()
})

it('keeps newer edits dirty when an earlier save finishes', async () => {
  const user = userEvent.setup()
  const delayed = { ...updateMock(revised), delay: 300 }
  renderPage({ path: '/', url: '/', mocks: [delayed], element: <SavedResumeEditor resumeId="resume-1" title="Engineer" markdown={original} onDeleted={vi.fn()} /> })
  const input = screen.getByRole('textbox', { name: 'Resume Markdown' })
  fireEvent.change(input, { target: { value: revised } })
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saving your resume…'))
  fireEvent.change(input, { target: { value: `${revised}\nMore edits.` } })
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes'))
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled()
})

it('keeps rejected edits available and exports locked until a successful retry', async () => {
  const user = userEvent.setup()
  renderEditor([updateMock(revised, ['Could not save your changes.']), updateMock(revised)])
  const input = screen.getByRole('textbox', { name: 'Resume Markdown' })
  fireEvent.change(input, { target: { value: revised } })
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  expect(await screen.findByText('Could not save your changes.')).toBeInTheDocument()
  expect(input).toHaveValue(revised)
  expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes')
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Download DOCX' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('All changes saved'))
  expect(screen.queryByText('Could not save your changes.')).not.toBeInTheDocument()
})

it('preserves the draft and error feedback after a network save failure', async () => {
  const user = userEvent.setup()
  renderPage({ path: '/', url: '/', mocks: [{ request: updateMock(revised).request, error: new Error('Disconnected') }], element: <SavedResumeEditor resumeId="resume-1" title="Engineer" markdown={original} onDeleted={vi.fn()} /> })
  fireEvent.change(screen.getByRole('textbox', { name: 'Resume Markdown' }), { target: { value: revised } })
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  expect(await screen.findByText("Couldn't save this resume. Check your connection and try again.")).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Resume Markdown' })).toHaveValue(revised)
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled()
})

describe.each([['PDF', downloadResumePdf], ['DOCX', downloadResumeDocx]] as const)('%s export', (format, download) => {
  it('uses the saved Markdown snapshot', async () => {
    const user = userEvent.setup()
    vi.mocked(download).mockClear()
    renderEditor([updateMock(revised)])
    await user.click(screen.getByRole('button', { name: `Download ${format}` }))
    expect(download).toHaveBeenCalledWith(original, 'Engineer')
    const input = screen.getByRole('textbox', { name: 'Resume Markdown' })
    fireEvent.change(input, { target: { value: revised } })
    expect(screen.getByRole('button', { name: `Download ${format}` })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Save resume' }))
    await waitFor(() => expect(screen.getByRole('button', { name: `Download ${format}` })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: `Download ${format}` }))
    expect(download).toHaveBeenLastCalledWith(revised, 'Engineer')
  })
})
