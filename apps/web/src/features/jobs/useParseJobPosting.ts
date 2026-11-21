/**
 * Description: Hook that starts parsing a pasted job advertisement into a job.
 * Index:
 *   - useParseJobPosting: returns parseJobPosting(text) plus loading and error state
 */
import { useState } from 'react'
import { useMutation } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { PARSE_JOB_POSTING_MUTATION } from './jobsOperations'

/** Calls the parseJobPosting mutation; resolves to the new AI task id, or null on errors. */
export function useParseJobPosting() {
  const [mutate, { loading }] = useMutation(PARSE_JOB_POSTING_MUTATION)
  const [errors, setErrors] = useState<string[]>([])
  const [errorCode, setErrorCode] = useState<string | null>(null)

  async function parseJobPosting(text: string): Promise<string | null> {
    setErrors([])
    setErrorCode(null)
    const trimmed = text.trim()
    if (!trimmed) {
      setErrors(['Paste the job ad.'])
      return null
    }
    try {
      const { data } = await mutate({ variables: { text: trimmed } })
      const payload = data?.parseJobPosting
      if (payload?.aiTask && payload.errors.length === 0) return payload.aiTask.id
      setErrorCode(payload?.errorCode ?? null)
      setErrors(payload?.errors.length ? payload.errors : ["Couldn't add this job. Please try again."])
    } catch (error) {
      setErrors([requestErrorMessage(error, "Couldn't reach the server. Check your connection and try again.")])
    }
    return null
  }

  return { parseJobPosting, submitting: loading, errors, errorCode }
}
