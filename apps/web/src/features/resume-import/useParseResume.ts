/**
 * Description: Hook that uploads a resume file and starts AI parsing.
 * Index:
 *   - useParseResume: returns parseResume(file) plus loading and error state
 */
import { useState } from 'react'
import { useMutation } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { PARSE_RESUME_MUTATION } from './resumeImportOperations'

/** Uploads a file with the parseResume mutation; resolves to the new AI task id, or null on errors. */
export function useParseResume() {
  const [mutate, { loading }] = useMutation(PARSE_RESUME_MUTATION)
  const [errors, setErrors] = useState<string[]>([])

  async function parseResume(file: File): Promise<string | null> {
    setErrors([])
    try {
      const { data } = await mutate({ variables: { file } })
      const payload = data?.parseResume
      if (payload?.aiTask && payload.errors.length === 0) return payload.aiTask.id
      setErrors(payload?.errors.length ? payload.errors : ['The upload failed. Please try again.'])
    } catch (error) {
      setErrors([requestErrorMessage(error, 'Could not upload the file. Check your connection and try again.')])
    }
    return null
  }

  return { parseResume, uploading: loading, errors }
}
