/** Build the same PDF used by preview and hand it to the browser as a download.
 * The caller supplies a saved snapshot. No document is uploaded or persisted.
 */
import { pdf } from '@react-pdf/renderer'
import { ResumePdfDocument } from './ResumePdfDocument'
import type { ResumePdfModel } from './resumePdfModel'

/** Render a captured resume using the preview's document and layout. */
export function generateResumePdf(model: ResumePdfModel): Promise<Blob> {
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
export async function downloadResumePdf(model: ResumePdfModel, title: string): Promise<void> {
  const blob = await generateResumePdf(model)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  try {
    anchor.href = url
    anchor.download = resumeDownloadFilename(title, 'pdf')
    document.body.append(anchor)
    anchor.click()
  } finally {
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}
