/**
 * Dismisses or restores one requirement of a job. The mutation returns the job's dismissed list,
 * so Apollo updates the Fit tab from the cache without a refetch.
 */
import { useState } from 'react'
import { useApolloClient } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { SET_GAP_DISMISSAL_MUTATION } from './gapAnalysisOperations'

/** Returns setDismissed(dismissed), which resolves true once the change is saved. */
export function useSetGapDismissal(jobId: string, requirement: string) {
  const client = useApolloClient()
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  async function setDismissed(dismissed: boolean) {
    setBusy(true)
    setErrors([])
    try {
      const { data } = await client.mutate({
        mutation: SET_GAP_DISMISSAL_MUTATION,
        variables: { jobId, requirement, dismissed },
      })
      const payload = data?.setGapDismissal
      if (payload && payload.errors.length === 0) return true
      setErrors(payload?.errors.length ? payload.errors : ['That didn’t work. Please try again.'])
    } catch (error) {
      setErrors([requestErrorMessage(error, 'Could not reach the server. Please try again.')])
    } finally {
      setBusy(false)
    }
    return false
  }

  return { setDismissed, busy, errors }
}
