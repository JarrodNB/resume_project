/** Check that save feedback and leave warnings follow what was actually persisted,
 * including failures and edits made while a request is still running.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link } from 'react-router'
import { expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { downloadResumePdf } from './resumePdfDownload'
import { SavedResumeEditor } from './SavedResumeEditor'
import { UPDATE_RESUME_MUTATION } from './tailorOperations'

vi.mock('./resumePdfDownload', () => ({ downloadResumePdf: vi.fn().mockResolvedValue(undefined) }))

vi.mock('./ResumePdfPreview', () => ({ ResumePdfPreview: () => null }))

const sections = [{ id: 'section-1', sectionType: 'SUMMARY', title: 'Summary', position: 0, content: { text: 'Original summary.' } }]

function updateMock(text: string, errors: string[] = [], delay = 10) {
  return {
    request: { query: UPDATE_RESUME_MUTATION, variables: { id: 'resume-1', sections: [{ id: 'section-1', content: { text } }] } },
    delay,
    result: { data: { updateResume: {
      __typename: 'UpdateResumePayload', errors,
      resume: errors.length ? null : { __typename: 'Resume', id: 'resume-1', title: 'Engineer', sections: [{ __typename: 'ResumeSection', ...sections[0], content: { text } }] },
    } } },
  }
}

function renderEditor(mocks: ReturnType<typeof updateMock>[] = []) {
  return renderPage({ path: '/', url: '/', mocks,
    element: <><SavedResumeEditor resumeId="resume-1" sections={sections} onDeleted={vi.fn()} /><Link to="/jobs">Jobs</Link></>,
    extraRoutes: [{ path: '/jobs', element: <p>Job list</p> }],
  })
}

it('protects edited content, recognizes reverted edits, and allows leaving after a successful save', async () => {
  const user = userEvent.setup()
  renderEditor([updateMock('Edited summary.')])
  expect(screen.getByRole('status')).toHaveTextContent('All changes saved')
  const cleanUnload = new Event('beforeunload', { cancelable: true })
  fireEvent(window, cleanUnload)
  expect(cleanUnload.defaultPrevented).toBe(false)
  await user.click(screen.getByRole('button', { name: 'Summary' }))
  const input = screen.getByRole('textbox', { name: 'Summary' })
  await user.type(input, ' Updated')
  expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes')
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled()
  const dirtyUnload = new Event('beforeunload', { cancelable: true })
  fireEvent(window, dirtyUnload)
  expect(dirtyUnload.defaultPrevented).toBe(true)
  await user.click(screen.getByRole('link', { name: 'Jobs' }))
  await user.click(screen.getByRole('button', { name: 'Keep editing' }))
  expect(input).toHaveValue('Original summary. Updated')
  await user.clear(input)
  await user.type(input, 'Original summary.')
  expect(screen.getByRole('status')).toHaveTextContent('All changes saved')
  await user.clear(input)
  await user.type(input, 'Edited summary.')
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('All changes saved'))
  const savedUnload = new Event('beforeunload', { cancelable: true })
  fireEvent(window, savedUnload)
  expect(savedUnload.defaultPrevented).toBe(false)
  await user.click(screen.getByRole('link', { name: 'Jobs' }))
  expect(await screen.findByText('Job list')).toBeInTheDocument()
})

it('keeps unsaved work after failure and clears its warning only after retry succeeds', async () => {
  const user = userEvent.setup()
  renderEditor([updateMock('Edited summary.', ['Save unavailable.']), updateMock('Edited summary.')])
  await user.click(screen.getByRole('button', { name: 'Summary' }))
  const input = screen.getByRole('textbox', { name: 'Summary' })
  await user.clear(input)
  await user.type(input, 'Edited summary.')
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  expect(await screen.findByText('Save unavailable.')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes')
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled()
  expect(input).toHaveValue('Edited summary.')
  await user.click(screen.getByRole('link', { name: 'Jobs' }))
  expect(screen.getByRole('dialog', { name: 'Leave without saving?' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Keep editing' }))
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('All changes saved'))
})

it('keeps later edits unsaved when an earlier snapshot finishes saving', async () => {
  const user = userEvent.setup()
  renderEditor([updateMock('Submitted summary.', [], 300)])
  await user.click(screen.getByRole('button', { name: 'Summary' }))
  const input = screen.getByRole('textbox', { name: 'Summary' })
  await user.clear(input)
  await user.type(input, 'Submitted summary.')
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  expect(screen.getByRole('status')).toHaveTextContent('Saving your resume…')
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled()
  await user.type(input, ' More edits.')
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes'))
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled()
  expect(input).toHaveValue('Submitted summary. More edits.')
  await user.click(screen.getByRole('link', { name: 'Jobs' }))
  expect(screen.getByRole('dialog', { name: 'Leave without saving?' })).toBeInTheDocument()
})


it('offers PDF only for saved content and requires saving edits before downloading', async () => {
  const user = userEvent.setup()
  renderEditor([updateMock('Edited summary.')])
  const download = screen.getByRole('button', { name: 'Download PDF' })
  expect(download).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Summary' }))
  await user.clear(screen.getByRole('textbox', { name: 'Summary' }))
  await user.type(screen.getByRole('textbox', { name: 'Summary' }), 'Edited summary.')
  expect(download).toBeDisabled()
  expect(screen.getByText('Save your changes to download')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  await waitFor(() => expect(download).toBeEnabled())
  await user.click(download)
  expect(downloadResumePdf).toHaveBeenLastCalledWith(expect.objectContaining({ blocks: [expect.objectContaining({ text: 'Edited summary.' })] }), '')
})


it('captures saved content, blocks duplicate generation, and preserves edits during export', async () => {
  const user = userEvent.setup()
  let finish!: () => void
  vi.mocked(downloadResumePdf).mockClear().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
  renderEditor()
  await user.click(screen.getByRole('button', { name: 'Download PDF' }))
  const preparing = screen.getByRole('button', { name: 'Preparing PDF…' })
  expect(preparing).toBeDisabled()
  await user.click(preparing)
  expect(downloadResumePdf).toHaveBeenCalledOnce()
  const captured = vi.mocked(downloadResumePdf).mock.calls[0][0]
  await user.click(screen.getByRole('button', { name: 'Summary' }))
  await user.type(screen.getByRole('textbox', { name: 'Summary' }), ' Later edit.')
  expect(captured.blocks[0].text).toBe('Original summary.')
  await act(async () => finish())
  expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes')
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled()
})

it('recovers after generation failure and allows retry without changing saved state', async () => {
  const user = userEvent.setup()
  vi.mocked(downloadResumePdf).mockClear().mockRejectedValueOnce(new Error('Renderer failed')).mockResolvedValueOnce(undefined)
  renderEditor()
  await user.click(screen.getByRole('button', { name: 'Download PDF' }))
  expect(await screen.findByText('Could not download the PDF. Please try again.')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('All changes saved')
  await user.click(screen.getByRole('button', { name: 'Download PDF' }))
  await waitFor(() => expect(downloadResumePdf).toHaveBeenCalledTimes(2))
  expect(screen.queryByText('Could not download the PDF. Please try again.')).not.toBeInTheDocument()
})
