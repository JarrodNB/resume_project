/** Exercise preview pagination status without requiring a browser PDF viewer. */
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ResumePdfPreview } from './ResumePdfPreview'
import { generateResumePdfArtifact } from './resumeDownload'
import type { ResumePdfModel } from './resumePdfModel'

vi.mock('./resumeDownload', () => ({ generateResumePdfArtifact: vi.fn() }))
const model: ResumePdfModel = { name: 'Ada', contactLine: '', links: [], blocks: [] }
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:resume'), revokeObjectURL: vi.fn() })
})

it('shows actual pages, target, and nonblocking overflow guidance for the displayed PDF', async () => {
  vi.mocked(generateResumePdfArtifact).mockResolvedValue({ blob: new Blob(), pageCount: 3 })
  render(<ResumePdfPreview model={model} targetPageCount={2} />)
  expect(screen.getByText('Counting PDF pages…')).toBeInTheDocument()
  expect(await screen.findByText('PDF: 3 pages · Target: 2 pages')).toBeInTheDocument()
  expect(screen.getByText(/Longer than your target. You can still save and download the full resume./)).toBeInTheDocument()
  expect(screen.getByTitle('Resume preview')).toHaveAttribute('src', 'blob:resume#toolbar=0&navpanes=0&zoom=100')
})

it('invalidates the old count immediately on editing and ignores an older render completing later', async () => {
  let finishOld!: (value: { blob: Blob; pageCount: number }) => void
  vi.mocked(generateResumePdfArtifact)
    .mockResolvedValueOnce({ blob: new Blob(), pageCount: 3 })
    .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
    .mockResolvedValueOnce({ blob: new Blob(), pageCount: 1 })
  const view = render(<ResumePdfPreview model={model} targetPageCount={2} />)
  await screen.findByText('PDF: 3 pages · Target: 2 pages')
  view.rerender(<ResumePdfPreview model={{ ...model, name: 'Grace' }} targetPageCount={2} />)
  expect(screen.queryByText('PDF: 3 pages · Target: 2 pages')).not.toBeInTheDocument()
  expect(screen.queryByTitle('Resume preview')).not.toBeInTheDocument()
  expect(screen.getByText('Counting PDF pages…')).toBeInTheDocument()
  await waitFor(() => expect(generateResumePdfArtifact).toHaveBeenCalledTimes(2))
  view.rerender(<ResumePdfPreview model={{ ...model, name: 'Katherine' }} targetPageCount={2} />)
  await screen.findByText('PDF: 1 page · Target: 2 pages')
  await act(async () => finishOld({ blob: new Blob(), pageCount: 8 }))
  expect(screen.getByText('PDF: 1 page · Target: 2 pages')).toBeInTheDocument()
  expect(screen.queryByText(/Longer than your target/)).not.toBeInTheDocument()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:resume')
  view.unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
})

it('reports failure without retaining a verified count and ignores stale failures after edits', async () => {
  let failOld!: (reason: Error) => void
  vi.mocked(generateResumePdfArtifact)
    .mockImplementationOnce(() => new Promise((_, reject) => { failOld = reject }))
    .mockResolvedValueOnce({ blob: new Blob(), pageCount: 1 })
    .mockRejectedValueOnce(new Error('render failed'))
  const view = render(<ResumePdfPreview model={model} targetPageCount={1} />)
  await waitFor(() => expect(generateResumePdfArtifact).toHaveBeenCalledTimes(1))
  view.rerender(<ResumePdfPreview model={{ ...model, name: 'Grace' }} targetPageCount={1} />)
  await screen.findByText('PDF: 1 page · Target: 1 page')
  await act(async () => failOld(new Error('old render failed')))
  expect(screen.getByText('PDF: 1 page · Target: 1 page')).toBeInTheDocument()
  view.rerender(<ResumePdfPreview model={{ ...model, name: 'Katherine' }} targetPageCount={1} />)
  expect(await screen.findByText("Couldn't count PDF pages. Close and reopen the preview to try again.")).toBeInTheDocument()
  expect(screen.queryByText('PDF: 1 page · Target: 1 page')).not.toBeInTheDocument()
  expect(screen.queryByTitle('Resume preview')).not.toBeInTheDocument()
})

it('recounts restored content rather than reusing its released preview URL', async () => {
  vi.mocked(generateResumePdfArtifact).mockResolvedValue({ blob: new Blob(), pageCount: 1 })
  const view = render(<ResumePdfPreview model={model} />)
  await screen.findByText('PDF: 1 page · Target: 2 pages')
  view.rerender(<ResumePdfPreview model={{ ...model, blocks: [{ title: 'Summary', text: 'Included again', entries: [] }] }} />)
  view.rerender(<ResumePdfPreview model={model} />)
  expect(screen.queryByTitle('Resume preview')).not.toBeInTheDocument()
  expect(screen.getByText('Counting PDF pages…')).toBeInTheDocument()
  await screen.findByText('PDF: 1 page · Target: 2 pages')
})
