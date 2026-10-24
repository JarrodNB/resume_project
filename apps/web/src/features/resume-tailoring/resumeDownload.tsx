/** Build saved resume downloads and hand their files to the browser.
 * The caller supplies a saved snapshot. No document is uploaded or persisted.
 */
import { pdf } from '@react-pdf/renderer'
import { ResumePdfDocument } from './ResumePdfDocument'

/** Render a captured resume using the preview's document and layout. */
export function generateResumePdf(model: string): Promise<Blob> {
  return pdf(<ResumePdfDocument model={model} />).toBlob()
}

/** Safe, bounded basename from the saved title, including a blank-title fallback. */
export function resumeDownloadFilename(title: string, extension: 'pdf' | 'docx'): string {
  // Control characters are intentionally removed from filesystem names.
  // oxlint-disable-next-line no-control-regex
  const basename = title.replace(/[\x00-\x1f\x7f/\\<>:"|?*]/g, '').trim().replace(/^[. ]+|[. ]+$/g, '').slice(0, 100).trim()
  return `${basename || 'resume'}.${extension}`
}

/** Keep the URL alive briefly so the browser can begin reading it after clicking. */
export async function downloadResumePdf(model: string, title: string): Promise<void> {
  const blob = await generateResumePdf(model)
  handOffDownload(blob, title, 'pdf')
}

/** Load the Word renderer only when the user requests an editable file. */
export async function downloadResumeDocx(model: string, title: string): Promise<void> {
  const { generateResumeDocx } = await import('./resumeDocxDocument')
  handOffDownload(await generateResumeDocx(model), title, 'docx')
}

/** Release the temporary browser URL after the browser has begun reading it. */
function handOffDownload(blob: Blob, title: string, format: 'pdf' | 'docx'): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  try {
    anchor.href = url
    anchor.download = resumeDownloadFilename(title, format)
    document.body.append(anchor)
    anchor.click()
  } finally {
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}
