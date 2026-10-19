/** Keeps import omissions visible after Job Board opens the saved job.
 * Route state belongs to this navigation only and must match the open job.
 */
import { useLocation } from 'react-router'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export function JobBoardImportNotice({ jobId }: { jobId: string }) {
  const location = useLocation()
  const notice = (location.state as { jobBoardImport?: { jobId?: unknown; warnings?: unknown } } | null)?.jobBoardImport
  const warnings = notice?.jobId === jobId && Array.isArray(notice.warnings)
    ? notice.warnings.filter((warning): warning is string => typeof warning === 'string') : []
  if (!warnings.length) return null
  return (
    <Alert>
      <AlertTitle>Saved with a few changes</AlertTitle>
      <AlertDescription><ul className="list-disc pl-5">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></AlertDescription>
    </Alert>
  )
}
