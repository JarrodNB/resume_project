/** Check that save feedback and leave warnings follow what was actually persisted,
 * including failures and edits made while a request is still running.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link } from 'react-router'
import { expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { SavedResumeEditor } from './SavedResumeEditor'
import { UPDATE_RESUME_MUTATION } from './tailorOperations'

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
  await user.type(input, ' More edits.')
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes'))
  expect(input).toHaveValue('Submitted summary. More edits.')
  await user.click(screen.getByRole('link', { name: 'Jobs' }))
  expect(screen.getByRole('dialog', { name: 'Leave without saving?' })).toBeInTheDocument()
})
