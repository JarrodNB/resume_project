/** Check safe browser filenames and the lifetime of download URLs without browser automation. */
import { afterEach, expect, it, vi } from 'vitest'
import { downloadResumePdf, resumeDownloadFilename } from './resumePdfDownload'

vi.mock('@react-pdf/renderer', async (original) => ({
  ...await original<typeof import('@react-pdf/renderer')>(),
  pdf: () => ({ toBlob: async () => new Blob(['pdf'], { type: 'application/pdf' }) }),
}))

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('uses bounded saved-title filenames and a safe fallback', () => {
  expect(resumeDownloadFilename(' Engineer / Acme\\Team: 2026? ', 'pdf')).toBe('Engineer  AcmeTeam 2026.pdf')
  expect(resumeDownloadFilename(' ../\\\u0000 ', 'pdf')).toBe('resume.pdf')
  expect(resumeDownloadFilename('x'.repeat(140), 'pdf')).toBe(`${'x'.repeat(100)}.pdf`)
})

it('clicks the filename download, removes the anchor, then revokes the URL after browser handoff', async () => {
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
  await downloadResumePdf({ name: '', contactLine: '', links: [], blocks: [] }, 'Saved title')
  expect(filename).toBe('Saved title.pdf')
  expect(document.querySelector('a[download]')).toBeNull()
  expect(revoke).not.toHaveBeenCalled()
  vi.advanceTimersByTime(60_000)
  expect(revoke).toHaveBeenCalledWith('blob:resume')
})
