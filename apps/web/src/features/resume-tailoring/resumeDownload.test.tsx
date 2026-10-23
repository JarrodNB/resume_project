/** Check safe browser filenames and the lifetime of download URLs without browser automation. */
import { afterEach, expect, it, vi } from 'vitest'
import { generateResumePdf, downloadResumePdf, downloadResumeDocx, resumeDownloadFilename } from './resumeDownload'

vi.mock('@react-pdf/renderer', async (original) => ({
  ...await original<typeof import('@react-pdf/renderer')>(),
  pdf: () => ({ toBlob: async () => new Blob(['pdf'], { type: 'application/pdf' }) }),
}))

vi.mock('./resumeDocxDocument', () => ({ generateResumeDocx: async () => new Blob(['docx']) }))

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('uses bounded saved-title filenames and a safe fallback', () => {
  expect(resumeDownloadFilename(' Engineer / Acme\\Team: 2026? ', 'pdf')).toBe('Engineer  AcmeTeam 2026.pdf')
  expect(resumeDownloadFilename(' ../\\\u0000 ', 'pdf')).toBe('resume.pdf')
  expect(resumeDownloadFilename(' ../\\\u0000 ', 'docx')).toBe('resume.docx')
  expect(resumeDownloadFilename('x'.repeat(140), 'pdf')).toBe(`${'x'.repeat(100)}.pdf`)
})

it.each([['pdf', downloadResumePdf], ['docx', downloadResumeDocx]] as const)('clicks the filename download, removes the anchor, then revokes the URL after browser handoff', async (format, download) => {
  vi.useFakeTimers()
  const create = vi.fn(() => 'blob:resume')
  const revoke = vi.fn()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }))
  let filename = ''
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    filename = this.download
    expect(this.href).toBe('blob:resume')
    expect(this.isConnected).toBe(true)
  })
  await download({ name: '', contactLine: '', links: [], blocks: [] }, 'Saved title')
  expect(filename).toBe(`Saved title.${format}`)
  expect(document.querySelector('a[download]')).toBeNull()
  expect(revoke).not.toHaveBeenCalled()
  vi.advanceTimersByTime(60_000)
  expect(revoke).toHaveBeenCalledWith('blob:resume')
})

it('returns downloadable PDF bytes even when pagination callbacks are unavailable', async () => {
  const blob = await generateResumePdf({ name: '', contactLine: '', links: [], blocks: [] })
  expect(blob.type).toBe('application/pdf')
  expect(blob.size).toBe(3)
})

it('hands the checked Word Blob to the browser without rendering replacement bytes', async () => {
  const checked = new Blob(['the exact checked export'])
  const create = vi.fn(() => 'blob:checked')
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }))
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  await downloadResumeDocx({ name: '', contactLine: '', links: [], blocks: [] }, 'Saved title', checked)
  expect(create).toHaveBeenCalledWith(checked)
})
