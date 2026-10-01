/**
 * Description: Prominent list of things the parser found ambiguous or skipped.
 * Index:
 *   - ParsingWarnings: amber alert; renders nothing when there are no warnings
 */
import { TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

/** Shows parsing warnings so the user checks those parts of the review first. */
export function ParsingWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null
  return (
    <Alert className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      <TriangleAlert />
      <AlertTitle>Please double-check these</AlertTitle>
      <AlertDescription className="text-amber-900/90 dark:text-amber-100/90">
        <ul className="list-disc pl-4">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
