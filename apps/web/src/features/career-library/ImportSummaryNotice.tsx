/**
 * Description: Notice shown on the career library right after an import, saying how many entries
 * were added and how many were merged into existing ones.
 * Index:
 *   - ImportSummaryNotice: renders nothing unless the page was opened with an import summary
 */
import { CircleCheck } from 'lucide-react'
import { useLocation } from 'react-router'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { describeImportSummary, importSummaryFromLocationState } from './importSummary'

/** Shows the import result passed in navigation state. */
export function ImportSummaryNotice() {
  const summary = importSummaryFromLocationState(useLocation().state)
  if (!summary) return null
  return (
    <Alert>
      <CircleCheck />
      <AlertTitle>Resume imported</AlertTitle>
      <AlertDescription>{describeImportSummary(summary)}</AlertDescription>
    </Alert>
  )
}
