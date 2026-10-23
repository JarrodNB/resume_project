/** Check that both editors use their target in preview and keep overflow exports available. */
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { FinalResumeEditor } from './FinalResumeEditor'
import { SavedResumeEditor } from './SavedResumeEditor'
import { downloadResumePdf, generateResumePdfArtifact } from './resumeDownload'

vi.mock('./resumeDownload', () => ({ generateResumePdfArtifact: vi.fn(), downloadResumePdf: vi.fn().mockResolvedValue(undefined), downloadResumeDocx: vi.fn() }))
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:resume'), revokeObjectURL: vi.fn() })
  vi.mocked(generateResumePdfArtifact).mockResolvedValue({ blob: new Blob(), pageCount: 2 })
})

it('previews a new draft against its chosen target, recounts excluded sections, and still saves overflow', async () => {
  const user = userEvent.setup()
  const save = vi.fn()
  renderPage({ path: '/', url: '/', element: <FinalResumeEditor jobId="job-1" targetPageCount={1} sections={[
    { sectionType: 'summary', title: 'Summary', content: { text: 'An engineer.' }, omitted: false },
    { sectionType: 'skills', title: 'Skills', content: { items: [{ name: 'Ruby' }] }, omitted: false },
  ]} warnings={[]} pending={false} errors={[]} onSave={save} /> })
  await user.click(screen.getByRole('button', { name: 'Review full resume' }))
  expect(await screen.findByText('PDF: 2 pages · Target: 1 page')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Close' }))
  await user.click(screen.getByRole('button', { name: 'Exclude Skills' }))
  await user.click(screen.getByRole('button', { name: 'Review full resume' }))
  expect(screen.getByText('Counting PDF pages…')).toBeInTheDocument()
  expect(await screen.findByText('PDF: 2 pages · Target: 1 page')).toBeInTheDocument()
  expect(vi.mocked(generateResumePdfArtifact).mock.lastCall?.[0].blocks).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: 'Close' }))
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  expect(save).toHaveBeenCalledWith([{ section_type: 'summary', title: 'Summary', content: { text: 'An engineer.' } }])
})

it('keeps the full saved PDF downloadable after a measured overflow warning', async () => {
  const user = userEvent.setup()
  renderPage({ path: '/', url: '/', element: <SavedResumeEditor resumeId="resume-1" title="Engineer" targetPageCount={1} sections={[
    { id: 'section-1', sectionType: 'SUMMARY', title: 'Summary', position: 0, content: { text: 'The complete saved summary.' } },
  ]} onDeleted={vi.fn()} /> })
  await user.click(screen.getByRole('button', { name: 'Preview' }))
  expect(await screen.findByText('PDF: 2 pages · Target: 1 page')).toBeInTheDocument()
  expect(screen.getByText(/Longer than your target/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Close' }))
  await user.click(screen.getByRole('button', { name: 'Download PDF' }))
  expect(downloadResumePdf).toHaveBeenCalledWith(expect.objectContaining({ blocks: [expect.objectContaining({ text: 'The complete saved summary.' })] }), 'Engineer')
})
