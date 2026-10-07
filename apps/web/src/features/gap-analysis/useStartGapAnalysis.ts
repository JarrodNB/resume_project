/**
 * Description: Hook that starts comparing a job with the user's career library.
 * Index:
 *   - useStartGapAnalysis: returns startGapAnalysis() plus loading and error state
 */
import { useState } from 'react'
import { useApolloClient, useMutation } from '@apollo/client/react'
import { JOB_QUERY } from '@/features/jobs/jobsOperations'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { ANALYZE_JOB_GAPS_MUTATION } from './gapAnalysisOperations'

/** Calls the analyzeJobGaps mutation, stores that task on the cached job, and resolves to its id, or null on errors. */
export function useStartGapAnalysis(jobId: string) {
  const client = useApolloClient()
  const [mutate, { loading }] = useMutation(ANALYZE_JOB_GAPS_MUTATION)
  const [errors, setErrors] = useState<string[]>([])

  async function startGapAnalysis(): Promise<string | null> {
    setErrors([])
    try {
      const { data } = await mutate({ variables: { jobId } })
      const payload = data?.analyzeJobGaps
      if (payload?.aiTask && payload.errors.length === 0) {
        const task = payload.aiTask
        client.cache.updateQuery({ query: JOB_QUERY, variables: { id: jobId } }, (existing) => {
          if (!existing?.job) return existing
          return {
            job: {
              ...existing.job,
              latestGapAnalysis: {
                __typename: 'AiTask',
                id: task.id,
                status: task.status,
                result: task.result ?? null,
                errorMessage: task.errorMessage ?? null,
                createdAt: task.createdAt,
              },
            },
          }
        })
        return task.id
      }
      setErrors(payload?.errors.length ? payload.errors : ["Couldn't start the comparison. Please try again."])
    } catch (error) {
      setErrors([requestErrorMessage(error, "Couldn't reach the server. Check your connection and try again.")])
    }
    return null
  }

  return { startGapAnalysis, starting: loading, errors }
}
