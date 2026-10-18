/** Exercises whole-draft editing and inclusion through the controls users interact with. */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { FinalResumeEditor } from './FinalResumeEditor'
import type { TailorSection } from './parseTailorTask'

const sections: TailorSection[] = [
  { sectionType: 'summary', title: 'Summary', content: { text: 'Backend engineer.' }, omitted: false },
  { sectionType: 'skills', title: 'Skills', content: { items: [{ name: 'Ruby', category: null }] }, omitted: false },
]

it('preserves edits when a section is collapsed, excluded, and included again', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn()
  render(<FinalResumeEditor jobId="job-1" sections={sections} warnings={[]} pending={false} errors={[]} onSave={onSave} />)

  expect(screen.queryByRole('textbox', { name: 'Summary' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Summary' }))
  await user.clear(screen.getByRole('textbox', { name: 'Summary' }))
  await user.type(screen.getByRole('textbox', { name: 'Summary' }), 'Edited summary.')
  await user.click(screen.getByRole('button', { name: 'Summary' }))
  await user.click(screen.getByRole('button', { name: 'Exclude Summary' }))
  await user.click(screen.getByRole('button', { name: 'Skills' }))
  expect(screen.getByText('Ruby')).toBeInTheDocument()
  await user.type(screen.getByRole('textbox', { name: 'New skill' }), 'Python{Enter}')
  await user.click(screen.getByRole('button', { name: 'Include Summary' }))
  await user.click(screen.getByRole('button', { name: 'Summary' }))
  expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue('Edited summary.')
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  expect(onSave).toHaveBeenCalledWith([
    { section_type: 'summary', title: 'Summary', content: { text: 'Edited summary.' } },
    { section_type: 'skills', title: 'Skills', content: { items: [{ name: 'Ruby', category: null }, { name: 'Python', category: null }] } },
  ])
})

vi.mock('./ResumePdfPreview', () => ({
  ResumePdfPreview: ({ model }: { model: unknown }) => <pre data-testid="pdf-model">{JSON.stringify(model)}</pre>,
}))

it('previews and saves only the selected sections with current edits in original order', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn()
  render(<FinalResumeEditor jobId="job-1" sections={sections} warnings={['Projects omitted: no relevant evidence.']} pending={false} errors={['Save unavailable.']} onSave={onSave} />)
  await user.click(screen.getByRole('button', { name: 'Summary' }))
  await user.clear(screen.getByRole('textbox', { name: 'Summary' }))
  await user.type(screen.getByRole('textbox', { name: 'Summary' }), 'Edited summary.')
  await user.click(screen.getByRole('button', { name: 'Exclude Skills' }))
  await user.click(screen.getByRole('button', { name: 'Preview' }))
  expect(JSON.parse(screen.getByTestId('pdf-model').textContent ?? '{}')).toMatchObject({
    blocks: [{ title: 'Summary', text: 'Edited summary.' }],
  })
  await user.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.getByText('Projects omitted: no relevant evidence.')).toBeInTheDocument()
  expect(screen.getByText('Save unavailable.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  expect(onSave).toHaveBeenCalledWith([{ section_type: 'summary', title: 'Summary', content: { text: 'Edited summary.' } }])
})

it('requires at least one included section and allows restoring a section before saving', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn()
  render(<FinalResumeEditor jobId="job-1" sections={sections} warnings={[]} pending={false} errors={[]} onSave={onSave} />)
  await user.click(screen.getByRole('button', { name: 'Exclude Summary' }))
  await user.click(screen.getByRole('button', { name: 'Exclude Skills' }))
  expect(screen.getByRole('button', { name: 'Save resume' })).toBeDisabled()
  expect(screen.getByText('Include at least one section to preview or save your resume.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  expect(onSave).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Include Skills' }))
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  expect(onSave).toHaveBeenCalledWith([{ section_type: 'skills', title: 'Skills', content: { items: [{ name: 'Ruby', category: null }] } }])
})
