/**
 * Description: Review step for a completed parse: the editable form wired to the import mutation.
 * Index:
 *   - ParsedResumeReview: imports the edited parse, then opens the career library with the
 *     added/merged counts
 */
import { useNavigate } from 'react-router'
import type { ParsedResume } from './parsedResume'
import { ParsedResumeForm } from './review/ParsedResumeForm'
import { useImportParsedResume } from './useImportParsedResume'

interface ParsedResumeReviewProps {
  aiTaskId: string
  parsedResume: ParsedResume
}

/** Shows the parse for editing; a successful import navigates to the career library. */
export function ParsedResumeReview({ aiTaskId, parsedResume }: ParsedResumeReviewProps) {
  const navigate = useNavigate()
  const { importParsedResume, importing, errors } = useImportParsedResume(aiTaskId)

  async function handleImport(edited: ParsedResume) {
    const outcome = await importParsedResume(edited)
    if (outcome) navigate('/library', { state: { importSummary: outcome.importSummary } })
  }

  return <ParsedResumeForm parsedResume={parsedResume} onImport={handleImport} importing={importing} errors={errors} />
}
