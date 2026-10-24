/** Verify preview loading, accessible page content, failure recovery, and cleanup.
 * Canvas drawing is mocked; browser QA checks the real PDF renderer.
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ResumePdfPages } from './ResumePdfPages'

const pdf = vi.hoisted(() => ({ getDocument: vi.fn(), GlobalWorkerOptions: { workerSrc: '' } }))
vi.mock('pdfjs-dist', () => pdf)

beforeEach(() => {
  pdf.getDocument.mockReset()
  vi.stubGlobal('ResizeObserver', class {
    callback: (entries: { contentRect: { width: number } }[]) => void
    constructor(callback: (entries: { contentRect: { width: number } }[]) => void) { this.callback = callback }
    observe() { this.callback([{ contentRect: { width: 612 } }]) }
    disconnect() {}
  })
})

it('renders all pages with accessible text and releases the PDF on unmount', async () => {
  const cancel = vi.fn()
  const destroy = vi.fn()
  const getPage = vi.fn().mockImplementation(async (number) => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel }),
    getTextContent: async () => ({ items: [{ str: `Resume page ${number}` }] }),
  }))
  pdf.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 2, getPage }), destroy })
  const view = render(<ResumePdfPages url="blob:resume" />)
  expect(await screen.findByText('Resume page 1')).toBeInTheDocument()
  expect(await screen.findByText('Resume page 2')).toBeInTheDocument()
  expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Resume preview' })).toHaveAttribute('tabindex', '0')
  view.unmount()
  expect(cancel).toHaveBeenCalledTimes(2)
  expect(destroy).toHaveBeenCalledOnce()
})

it('shows an actionable error when the PDF cannot load', async () => {
  pdf.getDocument.mockReturnValue({ promise: Promise.reject(new Error('Invalid PDF')), destroy: vi.fn() })
  render(<ResumePdfPages url="blob:broken" />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Switch to Edit sections')
})

it('does not draw a document that resolves after leaving the preview', async () => {
  let finish!: (value: unknown) => void
  const getPage = vi.fn()
  const destroy = vi.fn()
  pdf.getDocument.mockReturnValue({ promise: new Promise((resolve) => { finish = resolve }), destroy })
  const view = render(<ResumePdfPages url="blob:slow" />)
  await waitFor(() => expect(pdf.getDocument).toHaveBeenCalledOnce())
  view.unmount()
  await act(async () => { finish({ numPages: 1, getPage }) })
  expect(destroy).toHaveBeenCalledOnce()
  expect(getPage).not.toHaveBeenCalled()
})
