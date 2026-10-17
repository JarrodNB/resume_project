/** Export tests replace PDF rendering and network boundaries while exercising the
 * real saved editor, download and upload orchestration. */
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApolloLink, Observable } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { SavedResumeEditor } from './SavedResumeEditor'
import type { AtsReportFieldsFragment } from '@/graphql/generated/graphql'

const renderer = vi.hoisted(() => ({ toBlob: vi.fn(), pdf: vi.fn(), download: vi.fn(), createUrl: vi.fn(), revokeUrl: vi.fn() }))
vi.mock('@react-pdf/renderer', () => ({
  pdf: renderer.pdf, Document: 'div', Page: 'div', Text: 'span', View: 'div', Link: 'a', StyleSheet: { create: (value: unknown) => value },
}))
vi.mock('./ResumePdfPreview', () => ({ ResumePdfPreview: () => <div>Preview document</div> }))

const category: AtsReportFieldsFragment['contentQuality'] & { __typename: string } = { __typename: 'AtsCategory', status: 'completed', score: 90, reason: null, assessments: [], deductions: [] }
const report: AtsReportFieldsFragment & { __typename: string } = { __typename: 'AtsReport', id: 'run', runId: 'run', contentFingerprint: 'saved-fingerprint', jobFingerprint: 'job', rubricVersion: 'ats-v1', stateVersion: '0', observedAt: '2026-10-17T00:00:00.000000Z', createdAt: '2026-10-17T00:00:00Z', outdated: false, overallScore: null, jobAlignment: category, contentQuality: category, pdfReadability: { ...category, status: 'awaiting_export', score: null } }
const sections = [{ id: 'section', sectionType: 'SUMMARY', title: 'Summary', position: 0, content: { text: 'Engineer' } }]

beforeEach(() => {
  vi.clearAllMocks()
  renderer.toBlob.mockResolvedValue(new Blob(['%PDF-1.7 exact exported bytes'], { type: 'application/pdf' }))
  renderer.pdf.mockReturnValue({ toBlob: renderer.toBlob })
  renderer.createUrl.mockReturnValue('blob:resume')
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: renderer.createUrl })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: renderer.revokeUrl })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(renderer.download)
})

function setup({ legacy = false, uploadError = false, readError = false, businessError = '', displayedFingerprint = 'saved-fingerprint' } = {}) {
  const upload = vi.fn()
  const rerun = vi.fn()
  let currentReport = report
  let publish: (value: typeof report) => void = () => {}
  const link = new ApolloLink((operation) => new Observable((observer) => {
    switch (operation.operationName) {
      case 'ResumeAtsReport':
        if (readError) observer.error(new Error('Report read failed'))
        else observer.next({ data: { resume: { __typename: 'Resume', id: 'resume', atsReport: legacy ? null : currentReport } } })
        observer.complete()
        break
      case 'ResumeAtsReportUpdated': publish = (value) => observer.next({ data: { atsReportUpdated: value } }); break
      case 'RerunResumeAtsCheck':
        rerun()
        observer.next({ data: { rerunResumeAtsCheck: { __typename: 'RerunResumeAtsCheckPayload', report, errors: [] } } })
        observer.complete()
        break
      case 'UpdateResume':
        currentReport = { ...report, id: 'new-run', runId: 'new-run', contentFingerprint: 'new-fingerprint', createdAt: '2026-10-17T01:00:00Z' }
        observer.next({ data: { updateResume: { __typename: 'UpdateResumePayload', errors: [], resume: {
          __typename: 'Resume', id: 'resume', title: 'Resume', atsContentFingerprint: currentReport.contentFingerprint,
          sections: [{ __typename: 'ResumeSection', ...sections[0], content: operation.variables.sections[0].content }],
        } } } })
        observer.complete()
        break
      case 'SubmitResumeAtsPdf':
        upload(operation.variables)
        if (uploadError) observer.error(new Error('Upload unavailable'))
        else observer.next({ data: { submitResumeAtsPdf: { __typename: 'SubmitResumeAtsPdfPayload', report: businessError ? null : { ...currentReport, pdfReadability: { ...category, status: 'queued', score: null } }, errors: businessError ? [businessError] : [] } } })
        observer.complete()
        break
      default: observer.error(new Error(`Unexpected operation ${operation.operationName}`))
    }
  }))
  render(<MockedProvider link={link}><SavedResumeEditor resumeId="resume" sections={sections} atsContentFingerprint={displayedFingerprint} /></MockedProvider>)
  return { upload, rerun, publish: (value: typeof report) => publish(value) }
}

it('generates once, downloads before uploading and submits the exact bytes with saved identity', async () => {
  const { upload } = setup()
  await userEvent.click(await screen.findByRole('button', { name: 'Export PDF' }))
  await waitFor(() => expect(upload).toHaveBeenCalledOnce())
  expect(renderer.pdf).toHaveBeenCalledOnce()
  expect(renderer.toBlob).toHaveBeenCalledOnce()
  expect(renderer.createUrl).toHaveBeenCalledWith(await renderer.toBlob.mock.results[0].value)
  expect(renderer.download.mock.invocationCallOrder[0]).toBeLessThan(upload.mock.invocationCallOrder[0])
  const variables = upload.mock.calls[0][0]
  expect(variables).toMatchObject({ resumeId: 'resume', runId: 'run', contentFingerprint: 'saved-fingerprint', rendererVersion: 'resume-pdf-v1' })
  expect(variables.file).toBeInstanceOf(File)
  expect(await readBlob(variables.file)).toBe('%PDF-1.7 exact exported bytes')
})

it('requires saving dirty edits and leaves preview independent from ATS exports', async () => {
  const { upload } = setup()
  await userEvent.type(screen.getByRole('textbox', { name: 'Summary' }), ' changed')
  expect(screen.getByRole('button', { name: 'Export PDF' })).toBeDisabled()
  expect(screen.getByText(/Save resume before exporting/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
  expect(await screen.findByText('Preview document')).toBeInTheDocument()
  expect(renderer.pdf).not.toHaveBeenCalled()
  expect(upload).not.toHaveBeenCalled()
})

it('saves without PDF work and exports using the new saved draft identity', async () => {
  const { upload } = setup()
  await userEvent.type(screen.getByRole('textbox', { name: 'Summary' }), ' updated')
  await userEvent.click(screen.getByRole('button', { name: 'Save resume' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Export PDF' })).toBeEnabled())
  expect(renderer.pdf).not.toHaveBeenCalled()
  expect(upload).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Export PDF' }))
  await waitFor(() => expect(upload).toHaveBeenCalledOnce())
  expect(upload.mock.calls[0][0]).toMatchObject({ runId: 'new-run', contentFingerprint: 'new-fingerprint' })
  expect(renderer.pdf.mock.calls[0][0].props.model.blocks[0].text).toBe('Engineer updated')
})

it('preserves the download when upload fails and explains exporting again to retry', async () => {
  setup({ uploadError: true })
  await userEvent.click(await screen.findByRole('button', { name: 'Export PDF' }))
  expect(await screen.findByText(/Export again to retry the PDF check/)).toBeInTheDocument()
  expect(renderer.download).toHaveBeenCalledOnce()
})

it('creates a report for a legacy saved resume after downloading', async () => {
  const { upload, rerun } = setup({ legacy: true })
  await userEvent.click(await screen.findByRole('button', { name: 'Export PDF' }))
  await waitFor(() => expect(upload).toHaveBeenCalledOnce())
  expect(rerun).toHaveBeenCalledOnce()
  expect(renderer.download.mock.invocationCallOrder[0]).toBeLessThan(rerun.mock.invocationCallOrder[0])
})

it.each([true, false])('does not relabel an older displayed PDF with another tab’s report (legacy=%s)', async (legacy) => {
  const { upload } = setup({ legacy, displayedFingerprint: 'older-displayed-content' })
  await userEvent.click(await screen.findByRole('button', { name: 'Export PDF' }))
  expect(await screen.findByText(/Reload this resume before exporting again/)).toBeInTheDocument()
  expect(renderer.download).toHaveBeenCalledOnce()
  expect(upload).not.toHaveBeenCalled()
})

it('keeps a successful download and shows the server reason for rejecting stale bytes', async () => {
  setup({ businessError: 'The saved resume changed in another tab.' })
  await userEvent.click(await screen.findByRole('button', { name: 'Export PDF' }))
  expect(await screen.findByText(/The saved resume changed in another tab/)).toBeInTheDocument()
  expect(renderer.download).toHaveBeenCalledOnce()
})

it('can download and start inspection even when report reading failed', async () => {
  const { upload } = setup({ readError: true })
  await userEvent.click(await screen.findByRole('button', { name: 'Export PDF' }))
  await waitFor(() => expect(upload).toHaveBeenCalledOnce())
  expect(renderer.download).toHaveBeenCalledOnce()
})

it('does not download or upload when rendering fails', async () => {
  renderer.toBlob.mockRejectedValueOnce(new Error('Renderer unavailable'))
  const { upload } = setup()
  await userEvent.click(await screen.findByRole('button', { name: 'Export PDF' }))
  expect(await screen.findByText(/Couldn't create the PDF/)).toBeInTheDocument()
  expect(renderer.download).not.toHaveBeenCalled()
  expect(upload).not.toHaveBeenCalled()
})

it('shows PDF results from the report subscription without regenerating the file', async () => {
  const { publish } = setup()
  await userEvent.click(screen.getByRole('button', { name: /ATS check/ }))
  await act(async () => { publish({ ...report, stateVersion: "1", overallScore: 90, pdfReadability: { ...category, assessments: [{ key: 'reading_order', status: 'partial', ratio: 0.95, severity: 'warning', explanation: 'Check page order.', suggested_action: 'Review the PDF.', evidence: [{ page: 2, excerpt: 'Engineer' }] }] } }) })
  expect(screen.getByText('Page 2: “Engineer”')).toBeInTheDocument()
  expect(screen.getByText('Overall score: 90/100')).toBeInTheDocument()
  expect(renderer.pdf).not.toHaveBeenCalled()
})

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob) })
}
