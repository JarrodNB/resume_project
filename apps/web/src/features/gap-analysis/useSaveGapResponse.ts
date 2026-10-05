/**
 * Description: Hook that saves one gap response and refreshes the job so the answer survives
 * leaving the page.
 * Index:
 *   - useSaveGapResponse: returns save(requirement, body, addToLibrary), saving, and errors
 */
import { useState } from 'react'
import { useApolloClient } from '@apollo/client/react'
import { JOB_QUERY } from '@/features/jobs/jobsOperations'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { SAVE_GAP_RESPONSE_MUTATION } from './gapAnalysisOperations'
import type { SavedGapResponse } from './savedGapResponse'

/** Saves an answer for one requirement of `jobId`. A blank body clears it. */
export function useSaveGapResponse(jobId: string) {
  const client = useApolloClient()
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  /** Saves the answer and refetches the job. Returns the stored response, or null when cleared. */
  async function save(requirement: string, body: string, addToLibrary: boolean): Promise<SavedGapResponse | null | undefined> {
    setSaving(true)
    setErrors([])
    try {
      const { data } = await client.mutate({
        mutation: SAVE_GAP_RESPONSE_MUTATION,
        variables: { jobId, requirement, body, addToLibrary },
        refetchQueries: [{ query: JOB_QUERY, variables: { id: jobId } }],
        awaitRefetchQueries: true,
      })
      const payload = data?.saveGapResponse
      if (payload && payload.errors.length === 0) return payload.jobGapResponse
      setErrors(payload?.errors.length ? payload.errors : ['That didn’t work. Please try again.'])
    } catch (error) {
      setErrors([requestErrorMessage(error, 'Could not reach the server. Please try again.')])
    } finally {
      setSaving(false)
    }
    return undefined
  }

  return { save, saving, errors }
}
