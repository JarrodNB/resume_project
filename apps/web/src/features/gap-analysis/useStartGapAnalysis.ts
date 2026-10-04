/**
 * Description: Hook that starts comparing a job with the user's career library.
 * Index:
 *   - useStartGapAnalysis: returns startGapAnalysis() plus loading and error state
 */
import { useState } from 'react'
import { useMutation } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { ANALYZE_JOB_GAPS_MUTATION } from './gapAnalysisOperations'

/** Calls the analyzeJobGaps mutation; resolves to the new AI task id, or null on errors. */
export function useStartGapAnalysis(jobId: string) {
  const [mutate, { loading }] = useMutation(ANALYZE_JOB_GAPS_MUTATION)
  const [errors, setErrors] = useState<string[]>([])

  async function startGapAnalysis(): Promise<string | null> {
    setErrors([])
    try {
      const { data } = await mutate({ variables: { jobId } })
      const payload = data?.analyzeJobGaps
      if (payload?.aiTask && payload.errors.length === 0) return payload.aiTask.id
      setErrors(payload?.errors.length ? payload.errors : ["Couldn't start the comparison. Please try again."])
    } catch (error) {
      setErrors([requestErrorMessage(error, "Couldn't reach the server. Check your connection and try again.")])
    }
    return null
  }

  return { startGapAnalysis, starting: loading, errors }
}
