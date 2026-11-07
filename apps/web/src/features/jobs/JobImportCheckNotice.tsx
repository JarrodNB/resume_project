/**
 * Description: Red "check this" note shown above a job right after it was imported from a link or
 * pasted ad. It lists the import's warnings (like "AI identified the requirements and duties…")
 * and links to the Posting tab, where the lists can be read and edited.
 * Limits: the warnings travel in navigation state, so the note belongs to that one visit and only
 * shows for the matching job. Dismissing clears the state, so a reload does not bring it back.
 * Index:
 *   - JobImportCheckNotice: the note, or nothing
 */
import { Link, useLocation, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'

/** Shows import warnings for `jobId` from route state, with "Check them" and "Dismiss". */
export function JobImportCheckNotice({ jobId }: { jobId: string }) {
  const location = useLocation()
  const navigate = useNavigate()
  const notice = (location.state as { jobImportCheck?: { jobId?: unknown; warnings?: unknown } } | null)?.jobImportCheck
  const warnings = notice?.jobId === jobId && Array.isArray(notice.warnings)
    ? notice.warnings.filter((warning): warning is string => typeof warning === 'string') : []
  if (!warnings.length) return null

  return (
    <section aria-labelledby="job-import-check-title" className="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-md border-[1.5px] border-signal-action px-4 py-3.5">
      <div className="flex min-w-0 flex-1 basis-80 items-start gap-3">
        <span className="signal-dot is-action mt-1.5" aria-hidden />
        <div className="grid gap-1 text-sm">
          <h2 id="job-import-check-title" className="font-bold">Job saved. Check what the AI found.</h2>
          <ul className="grid gap-0.5">
            {warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      </div>
      <div className="flex gap-2">
        <Button asChild><Link to={`/jobs/${jobId}/posting`}>Check them</Link></Button>
        <Button variant="outline" onClick={() => navigate(location.pathname, { replace: true, state: null })}>Dismiss</Button>
      </div>
    </section>
  )
}
