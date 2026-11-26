/**
 * Description: Notice shown on the career library right after an import. It says what was added
 * and merged, and is cleared from the browser history entry so a refresh does not bring it back.
 * If the user has no saved jobs yet, it also points at the next step (saving a job) and stays
 * until dismissed, so the links don't vanish while being read; otherwise it hides on its own.
 * Index:
 *   - IMPORT_SUMMARY_NOTICE_MS: how long the notice stays if it is not dismissed
 *   - ImportSummaryNotice: renders nothing unless this visit arrived with an import summary
 */
import { useEffect, useState } from 'react'
import { useQuery } from '@apollo/client/react'
import { CircleCheck } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import { AlertDescription, AlertTitle } from '@/components/ui/alert'
import { TransientAlert, TRANSIENT_ALERT_MS } from '@/components/TransientAlert'
import { JOB_PIPELINE_QUERY } from '@/features/home/homeOperations'
import { describeImportSummary, importSummaryFromLocationState, type ImportSummary } from './importSummary'

const NEXT_LINK = 'font-medium text-foreground underline underline-offset-4'

/** How long the notice stays on screen when it is left alone. */
export const IMPORT_SUMMARY_NOTICE_MS = TRANSIENT_ALERT_MS

/** Shows the import result for this visit, then forgets it. */
export function ImportSummaryNotice() {
  const arrivedWith = importSummaryFromLocationState(useLocation().state)
  const [summary] = useState<ImportSummary | null>(arrivedWith)
  // Shares Home's job list (and its cache); only asked for when there is a notice to show.
  const jobs = useQuery(JOB_PIPELINE_QUERY, { fetchPolicy: 'cache-and-network', skip: !summary })
  const noSavedJobs = jobs.data?.jobPipeline.length === 0

  useEffect(() => {
    if (arrivedWith) clearImportSummaryFromHistory()
  }, [arrivedWith])

  if (!summary) return null

  return (
    <TransientAlert autoDismiss={!noSavedJobs}>
      <CircleCheck />
      <AlertTitle>Resume imported</AlertTitle>
      <AlertDescription>
        <p>{describeImportSummary(summary)}</p>
        {noSavedJobs && (
          <p>
            <strong>Next: save a job you want.</strong>{' '}
            <Link to="/jobs/find" className={NEXT_LINK}>Find jobs</Link>,{' '}
            <Link to="/jobs/paste" className={NEXT_LINK}>paste a job ad</Link> or{' '}
            <Link to="/jobs/new" className={NEXT_LINK}>add a posting link</Link>.
          </p>
        )}
      </AlertDescription>
    </TransientAlert>
  )
}

/** Drops `importSummary` from the current history entry without navigating. */
function clearImportSummaryFromHistory() {
  const current = window.history.state
  if (!current || typeof current !== 'object' || current.usr == null || typeof current.usr !== 'object') return
  if (!('importSummary' in current.usr)) return
  const rest = { ...current.usr }
  delete rest.importSummary
  window.history.replaceState({ ...current, usr: Object.keys(rest).length > 0 ? rest : null }, '')
}
