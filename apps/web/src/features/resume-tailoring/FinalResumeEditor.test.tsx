/** Test editing, preview, and the once-only draft save through visible controls. */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link } from 'react-router'
import { expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { FinalResumeEditor } from './FinalResumeEditor'

vi.mock('./ResumePdfPreview', () => ({ ResumePdfPreview: ({ model }: { model: string }) => <pre data-testid="pdf-model">{model}</pre> }))
const initial = '# Ada\n\nBackend engineer.'
function render(onSave = vi.fn().mockResolvedValue(true)) {
  return renderPage({ path: '/', url: '/', element: <><FinalResumeEditor markdown={initial} warnings={['Check dates.']} pending={false} errors={[]} onSave={onSave} /><Link to="/jobs">Jobs</Link></>, extraRoutes: [{ path: '/jobs', element: <p>Job list</p> }] })
}

it('warns before leaving an unsaved draft and previews and saves current Markdown', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn().mockResolvedValue(true)
  render(onSave)
  expect(screen.getByText('Check dates.')).toBeInTheDocument()
  const input = screen.getByRole('textbox', { name: 'Resume Markdown' })
  await user.clear(input)
  await user.type(input, '# Ada\n\nRevised')
  await user.click(screen.getByRole('button', { name: 'Review full resume' }))
  expect(screen.getByTestId('pdf-model')).toHaveTextContent('# Ada Revised')
  await user.click(screen.getByRole('button', { name: 'Close' }))
  const unload = new Event('beforeunload', { cancelable: true })
  fireEvent(window, unload)
  expect(unload.defaultPrevented).toBe(true)
  await user.click(screen.getByRole('link', { name: 'Jobs' }))
  expect(screen.getByRole('dialog', { name: 'Leave without saving?' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Keep editing' }))
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  expect(onSave).toHaveBeenCalledWith('# Ada\n\nRevised')
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('All changes saved'))
})

it('keeps the draft unsaved after a rejected save', async () => {
  const user = userEvent.setup()
  render(vi.fn().mockResolvedValue(false))
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes')
})
