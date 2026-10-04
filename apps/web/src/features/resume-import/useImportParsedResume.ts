/**
 * Description: Hook that imports a reviewed ParsedResume into the career library.
 * Index:
 *   - ImportOutcome: what a successful import reports back
 *   - useImportParsedResume: returns importParsedResume(parsedResume) plus loading and error state
 */
import { useState } from 'react'
import { useMutation } from '@apollo/client/react'
import { readImportSummary, type ImportSummary } from '@/features/career-library/importSummary'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import type { ParsedResume } from './parsedResume'
import { IMPORT_PARSED_RESUME_MUTATION } from './resumeImportOperations'

export interface ImportOutcome {
  importSummary: ImportSummary | null
}

/** Imports the edited parse for `aiTaskId`; resolves to the outcome on success, or null. */
export function useImportParsedResume(aiTaskId: string) {
  const [mutate, { loading }] = useMutation(IMPORT_PARSED_RESUME_MUTATION)
  const [errors, setErrors] = useState<string[]>([])

  async function importParsedResume(parsedResume: ParsedResume): Promise<ImportOutcome | null> {
    setErrors([])
    try {
      const { data } = await mutate({ variables: { aiTaskId, parsedResume } })
      const payload = data?.importParsedResume
      if (payload?.aiTask && payload.errors.length === 0) {
        return { importSummary: readImportSummary(payload.aiTask.result) }
      }
      setErrors(payload?.errors.length ? payload.errors : ['The import failed. Please try again.'])
    } catch (error) {
      setErrors([requestErrorMessage(error, 'Could not reach the server. Please try again.')])
    }
    return null
  }

  return { importParsedResume, importing: loading, errors }
}
