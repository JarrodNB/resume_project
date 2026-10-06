/**
 * Description: Notice shown on the career library right after an import. It can be dismissed,
 * hides on its own, and is cleared from the browser history entry so a refresh does not bring
 * it back.
 * Index:
 *   - IMPORT_SUMMARY_NOTICE_MS: how long the notice stays if it is not dismissed
 *   - ImportSummaryNotice: renders nothing unless this visit arrived with an import summary
 */
import { useEffect, useState } from 'react'
import { CircleCheck, X } from 'lucide-react'
import { useLocation } from 'react-router'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { describeImportSummary, importSummaryFromLocationState, type ImportSummary } from './importSummary'

/** How long the notice stays on screen when it is left alone. */
export const IMPORT_SUMMARY_NOTICE_MS = 8000

/** Shows the import result for this visit, then forgets it. */
export function ImportSummaryNotice() {
  const arrivedWith = importSummaryFromLocationState(useLocation().state)
  const [summary, setSummary] = useState<ImportSummary | null>(arrivedWith)

  useEffect(() => {
    if (arrivedWith) clearImportSummaryFromHistory()
  }, [arrivedWith])

  useEffect(() => {
    if (!summary) return
    const timer = window.setTimeout(() => setSummary(null), IMPORT_SUMMARY_NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [summary])

  if (!summary) return null

  return (
    <Alert>
      <CircleCheck />
      <AlertTitle>Resume imported</AlertTitle>
      <AlertDescription>{describeImportSummary(summary)}</AlertDescription>
      <AlertAction>
        <Button variant="ghost" size="icon-xs" aria-label="Dismiss" onClick={() => setSummary(null)}>
          <X />
        </Button>
      </AlertAction>
    </Alert>
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
