/** Exports one PDF, then sends those exact bytes for inspection. Download finishes
 * independently of ATS scheduling; retrying inspection requires another export. */
import { useRef, useState } from 'react'
import { useMutation } from '@apollo/client/react'
import { pdf } from '@react-pdf/renderer'
import type { AtsReportFieldsFragment } from '@/graphql/generated/graphql'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { ResumePdfDocument } from './ResumePdfDocument'
import type { ResumePdfModel } from './resumePdfModel'
import { RERUN_ATS_CHECK_MUTATION, SUBMIT_ATS_PDF_MUTATION } from './atsOperations'

export const RESUME_PDF_RENDERER_VERSION = 'resume-pdf-v1'

export function useResumePdfExport(resumeId: string, onReport: (report: AtsReportFieldsFragment) => void) {
  const [submit] = useMutation(SUBMIT_ATS_PDF_MUTATION)
  const [ensureReport] = useMutation(RERUN_ATS_CHECK_MUTATION)
  const [pending, setPending] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [status, setStatus] = useState('')
  const inFlight = useRef(false)

  async function exportPdf(model: ResumePdfModel, savedReport: AtsReportFieldsFragment | null) {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setErrors([])
    setStatus('Preparing PDF…')
    let downloaded = false
    try {
      const blob = await pdf(<ResumePdfDocument model={model} />).toBlob()
      const fileName = `${model.name?.trim() || 'Resume'}.pdf`
      download(blob, fileName)
      downloaded = true
      setStatus('PDF downloaded. Starting its readability check…')

      // Older saved resumes may predate automatic checks. An explicit export can
      // create a saved run without saving the draft or waiting for content results.
      let report = savedReport
      if (!report) {
        const result = await ensureReport({ variables: { resumeId } })
        const payload = result.data?.rerunResumeAtsCheck
        if (payload?.errors.length || !payload?.report) throw new PdfCheckError(payload?.errors.join(' ') || 'Could not create an ATS report.')
        report = payload.report
        onReport(report)
      }
      const result = await submit({ variables: {
        resumeId, runId: report.runId, contentFingerprint: report.contentFingerprint,
        rendererVersion: RESUME_PDF_RENDERER_VERSION,
        file: new File([blob], fileName, { type: 'application/pdf' }),
      } })
      const payload = result.data?.submitResumeAtsPdf
      if (payload?.errors.length || !payload?.report) throw new PdfCheckError(payload?.errors.join(' ') || 'Could not start PDF inspection.')
      onReport(payload.report)
      setStatus('PDF downloaded. Follow its readability check in ATS check below.')
    } catch (error) {
      if (downloaded) {
        setStatus('PDF downloaded.')
        const reason = error instanceof PdfCheckError ? error.message : requestErrorMessage(error, "Couldn't start the PDF check.")
        setErrors([`${reason} Export again to retry the PDF check. If the saved version changed, reload this resume first.`])
      } else {
        setStatus('')
        setErrors([requestErrorMessage(error, "Couldn't create the PDF. Try exporting again.")])
      }
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return { exportPdf, pending, errors, status }
}

/** Server validation messages are safe to display; transport failures get a friendly fallback. */
class PdfCheckError extends Error {}

/** The browser starts downloading immediately; retain its URL briefly while it reads. */
function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  try { anchor.click() }
  finally {
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
