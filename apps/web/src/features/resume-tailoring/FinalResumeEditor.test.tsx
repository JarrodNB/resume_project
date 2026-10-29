/** Exercises whole-draft editing and inclusion through the controls users interact with. */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { Link } from 'react-router'
import type { ReactElement } from 'react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { FinalResumeEditor } from './FinalResumeEditor'
import { renderPage } from '@/test/renderPage'
import type { TailorSection } from './parseTailorTask'

const sections: TailorSection[] = [
  { sectionType: 'summary', title: 'Summary', content: { text: 'Backend engineer.' }, omitted: false },
  { sectionType: 'skills', title: 'Skills', content: { items: [{ name: 'Ruby', category: null }] }, omitted: false },
]

function render(element: ReactElement) {
  return renderPage({ path: '/', url: '/', element: <>{element}<Link to="/jobs">Jobs</Link></>, extraRoutes: [{ path: '/jobs', element: <p>Job list</p> }] })
}

it('warns before discarding a new draft and keeps it when navigation is canceled', async () => {
  const user = userEvent.setup()
  const { router } = render(<FinalResumeEditor jobId="job-1" sections={sections} warnings={[]} pending={false} errors={[]} onSave={vi.fn()} />)
  expect(screen.queryByRole('button', { name: 'Download PDF' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Download DOCX' })).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes')
  const unload = new Event('beforeunload', { cancelable: true })
  fireEvent(window, unload)
  expect(unload.defaultPrevented).toBe(true)
  await user.click(screen.getByRole('button', { name: 'Edit sections' }))
  await user.click(screen.getByRole('button', { name: 'Exclude Skills' }))
  await user.click(screen.getByRole('link', { name: 'Jobs' }))
  expect(screen.getByRole('dialog', { name: 'Leave without saving?' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Keep editing' }))
  expect(router.state.location.pathname).toBe('/')
  expect(screen.getByRole('button', { name: 'Include Skills' })).toBeInTheDocument()
  await user.click(screen.getByRole('link', { name: 'Jobs' }))
  await user.click(screen.getByRole('button', { name: 'Discard and leave' }))
  expect(await screen.findByText('Job list')).toBeInTheDocument()
})

it('clears a new draft warning only when its save succeeds', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  render(<FinalResumeEditor jobId="job-1" sections={sections} warnings={[]} pending={false} errors={[]} onSave={onSave} />)
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes')
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('All changes saved'))
  await user.click(screen.getByRole('link', { name: 'Jobs' }))
  expect(await screen.findByText('Job list')).toBeInTheDocument()
})

it('preserves edits when a section is collapsed, excluded, and included again', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn()
  render(<FinalResumeEditor jobId="job-1" sections={sections} warnings={[]} pending={false} errors={[]} onSave={onSave} />)

  expect(screen.getByTestId('pdf-model')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('button', { name: 'Summary' })).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: 'Summary' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Edit sections' }))
  await user.click(screen.getByRole('button', { name: 'Summary' }))
  await user.clear(screen.getByRole('textbox', { name: 'Summary' }))
  await user.type(screen.getByRole('textbox', { name: 'Summary' }), 'Edited summary.')
  await user.click(screen.getByRole('button', { name: 'Summary' }))
  await user.click(screen.getByRole('checkbox', { name: 'Include summary' }))
  await user.click(screen.getByRole('button', { name: 'Skills' }))
  expect(screen.getByText('Ruby')).toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: 'New skill' }), 'Python{Enter}')
  await user.click(screen.getByRole('checkbox', { name: 'Include summary' }))
  await user.click(screen.getByRole('button', { name: 'Summary' }))
  expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue('Edited summary.')
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  expect(onSave).toHaveBeenCalledWith([
    { section_type: 'summary', title: 'Summary', content: { text: 'Edited summary.' } },
    { section_type: 'skills', title: 'Skills', content: { items: [{ name: 'Ruby', category: null }, { name: 'Python', category: null }] } },
  ], true)
})

vi.mock('./ResumePdfPreview', () => ({
  ResumePdfPreview: ({ model }: { model: unknown }) => <pre data-testid="pdf-model">{JSON.stringify(model)}</pre>,
}))

it('previews and saves only the selected sections with current edits in original order', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn()
  render(<FinalResumeEditor jobId="job-1" sections={sections} warnings={['Projects omitted: no relevant evidence.']} pending={false} errors={['Save unavailable.']} onSave={onSave} />)
  await user.click(screen.getByRole('button', { name: 'Edit sections' }))
  await user.click(screen.getByRole('button', { name: 'Summary' }))
  await user.clear(screen.getByRole('textbox', { name: 'Summary' }))
  await user.type(screen.getByRole('textbox', { name: 'Summary' }), 'Edited summary.')
  await user.click(screen.getByRole('button', { name: 'Exclude Skills' }))
  expect(screen.getByText('Your draft is ready to review')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save resume' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Preview' }))
  expect(JSON.parse(screen.getByTestId('pdf-model').textContent ?? '{}')).toMatchObject({
    blocks: [{ title: 'Summary', text: 'Edited summary.' }],
  })
  await user.click(screen.getByRole('button', { name: 'Edit sections' }))
  expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue('Edited summary.')
  expect(screen.getByRole('button', { name: 'Include Skills' })).toBeInTheDocument()
  expect(screen.getByText('Projects omitted: no relevant evidence.')).toBeInTheDocument()
  expect(screen.getByText('Save unavailable.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  expect(onSave).toHaveBeenCalledWith([{ section_type: 'summary', title: 'Summary', content: { text: 'Edited summary.' } }], true)
})

it('requires at least one included section and allows restoring a section before saving', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn()
  render(<FinalResumeEditor jobId="job-1" sections={sections} warnings={[]} pending={false} errors={[]} onSave={onSave} />)
  await user.click(screen.getByRole('button', { name: 'Edit sections' }))
  await user.click(screen.getByRole('checkbox', { name: 'Include summary' }))
  await user.click(screen.getByRole('button', { name: 'Exclude Skills' }))
  expect(screen.getByRole('button', { name: 'Save resume' })).toBeDisabled()
  expect(screen.getByText('Include at least one section to preview or save your resume.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  expect(onSave).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Include Skills' }))
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  expect(onSave).toHaveBeenCalledWith([
    { section_type: 'summary', title: 'Summary', content: { text: 'Backend engineer.' } },
    { section_type: 'skills', title: 'Skills', content: { items: [{ name: 'Ruby', category: null }] } },
  ], false)
})

it('retains an excluded summary in the first save and passes its inclusion separately', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn()
  render(<FinalResumeEditor jobId="job-1" sections={sections} warnings={[]} pending={false} errors={[]} onSave={onSave} />)
  await user.click(screen.getByRole('button', { name: 'Edit sections' }))
  await user.click(screen.getByRole('checkbox', { name: 'Include summary' }))
  await user.click(screen.getByRole('button', { name: 'Preview' }))
  expect(screen.getByTestId('pdf-model')).not.toHaveTextContent('Backend engineer.')
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  expect(onSave).toHaveBeenCalledWith([
    { section_type: 'summary', title: 'Summary', content: { text: 'Backend engineer.' } },
    { section_type: 'skills', title: 'Skills', content: { items: [{ name: 'Ruby', category: null }] } },
  ], false)
})

it('uses a disabled summary default even before summary text exists', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn()
  render(<FinalResumeEditor jobId="job-1" sections={[sections[1]]} includeSummary={false} warnings={[]} pending={false} errors={[]} onSave={onSave} />)
  await user.click(screen.getByRole('button', { name: 'Edit sections' }))
  expect(screen.getByRole('checkbox', { name: 'Include summary' })).not.toBeChecked()
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  expect(onSave).toHaveBeenCalledWith([{ section_type: 'skills', title: 'Skills', content: { items: [{ name: 'Ruby', category: null }] } }], false)
})
