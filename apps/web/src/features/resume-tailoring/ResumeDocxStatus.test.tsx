/** Exercise editor wiring using actual GraphQL documents and exact download bytes. */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { SavedResumeEditor } from './SavedResumeEditor'
import { FinalResumeEditor } from './FinalResumeEditor'
import { START_DOCX_CHECK, DOCX_CHECK } from './docxCheckOperations'
import { downloadResumeDocx } from './resumeDownload'
const blob = new Blob(['checked bytes'])
const digest = 'ab'.repeat(32)
vi.mock('./resumeDocxDocument', () => ({ generateResumeDocx: vi.fn(async () => blob) }))
vi.mock('./resumeDownload', () => ({ downloadResumeDocx: vi.fn(async () => {}), downloadResumePdf: vi.fn(async () => {}) }))
vi.mock('./ResumePdfPreview', () => ({ ResumePdfPreview: () => <p>PDF: 1 page</p> }))
const sections = [{ id: 's1', sectionType: 'SUMMARY', title: 'Summary', position: 0, content: { text: 'Engineer' } }]
const check = { __typename: 'ResumeDocxPageCheck', id: 'c1', status: 'queued', contentDigest: digest, pageCount: null, errorCode: null, expiresAt: new Date(Date.now() + 60_000).toISOString() }
beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(blob, 'arrayBuffer', { configurable: true, value: async () => new ArrayBuffer(1) })
  vi.stubGlobal('crypto', { subtle: { digest: vi.fn(async () => new Uint8Array(32).fill(171).buffer) } })
})
it('shows separate Word count and nonblocking overflow, downloading the checked Blob while pending', async () => {
  renderPage({ path: '/', url: '/', element: <SavedResumeEditor resumeId="r1" sections={sections} targetPageCount={1} onDeleted={() => {}} />, mocks: [
    { request: { query: START_DOCX_CHECK, variables: { file: blob, contentDigest: digest, resumeId: 'r1', retryFailed: false } }, result: { data: { startResumeDocxPageCheck: { __typename: 'StartResumeDocxPageCheckPayload', check, errors: [] } } } },
    { request: { query: DOCX_CHECK, variables: { id: 'c1' } }, result: { data: { resumeDocxPageCheck: { ...check, status: 'completed', pageCount: 3 } } } },
  ] })
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  expect(await screen.findByText('Checking DOCX pages…')).toBeInTheDocument()
  expect(screen.getByText('PDF: 1 page')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Download DOCX anyway' }))
  await waitFor(() => expect(downloadResumeDocx).toHaveBeenCalledWith(expect.any(Object), '', blob))
  expect(await screen.findByText('DOCX (LibreOffice): 3 pages · Target: 1 page', {}, { timeout: 3000 })).toBeInTheDocument()
  expect(screen.getByText(/DOCX is longer/)).toBeInTheDocument()
})
it('checks an unsaved draft without a resume ID and keeps failed checks retryable', async () => {
  renderPage({ path: '/', url: '/', element: <FinalResumeEditor jobId="j1" sections={[{ sectionType: 'summary', omitted: false, title: 'Summary', content: { text: 'Engineer' } }]} warnings={[]} pending={false} errors={[]} onSave={() => true} />, mocks: [
    { request: { query: START_DOCX_CHECK, variables: { file: blob, contentDigest: digest, retryFailed: false } }, result: { data: { startResumeDocxPageCheck: { __typename: 'StartResumeDocxPageCheckPayload', check: { ...check, status: 'failed' }, errors: [] } } } },
  ] })
  fireEvent.click(screen.getByRole('button', { name: 'Review full resume' }))
  expect(await screen.findByText('DOCX page count unavailable.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Retry DOCX page check' })).toBeEnabled()
  expect(screen.getByText(/Microsoft Word may paginate differently/)).toBeInTheDocument()
})
