/**
 * Description: Hook that imports a reviewed ParsedResume into the career library.
 * Index:
 *   - useImportParsedResume: returns importParsedResume(parsedResume) plus loading and error state
 */
import { useState } from 'react'
import { useMutation } from '@apollo/client/react'
import type { ParsedResume } from './parsedResume'
import { IMPORT_PARSED_RESUME_MUTATION } from './resumeImportOperations'

/** Imports the edited parse for `aiTaskId`; resolves to true on success. */
export function useImportParsedResume(aiTaskId: string) {
  const [mutate, { loading }] = useMutation(IMPORT_PARSED_RESUME_MUTATION)
  const [errors, setErrors] = useState<string[]>([])

  async function importParsedResume(parsedResume: ParsedResume): Promise<boolean> {
    setErrors([])
    try {
      const { data } = await mutate({ variables: { aiTaskId, parsedResume } })
      const payload = data?.importParsedResume
      if (payload?.resume && payload.errors.length === 0) return true
      setErrors(payload?.errors.length ? payload.errors : ['The import failed. Please try again.'])
    } catch {
      setErrors(['Could not reach the server. Please try again.'])
    }
    return false
  }

  return { importParsedResume, importing: loading, errors }
}
