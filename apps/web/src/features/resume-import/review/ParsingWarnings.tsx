/**
 * Description: Prominent list of things the parser found ambiguous or skipped.
 * Index:
 *   - ParsingWarnings: a red "needs you" alert; renders nothing when there are no warnings
 */
import { TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

/** Shows parsing warnings so the user checks those parts of the review first. */
export function ParsingWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null
  return (
    <Alert className="border-signal-action">
      <TriangleAlert className="text-signal-action-text" />
      <AlertTitle>Please double-check these</AlertTitle>
      <AlertDescription className="text-foreground">
        <ul className="list-disc pl-4">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
