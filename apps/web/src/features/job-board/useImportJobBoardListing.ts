/** Saves a listing through Rails. The session visit keeps its lock and feedback
 * across navigation, including a save that finishes while the board is closed.
 */
import { useApolloClient } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import type { JobBoardVisit } from './useJobBoardVisit'
import { IMPORT_JOB_BOARD_LISTING_MUTATION } from './jobBoardOperations'

export function useImportJobBoardListing(visit: JobBoardVisit) {
  const client = useApolloClient()
  const { busyId, importErrors: errors } = visit.getState()
  const setBusyId = (busyId: string | null) => visit.update({ busyId })
  const setErrors = (importErrors: string[]) => visit.update({ importErrors })

  async function save(listingId: string) {
    if (visit.getState().busyId) return null
    setBusyId(listingId)
    setErrors([])
    try {
      const { data } = await client.mutate({ mutation: IMPORT_JOB_BOARD_LISTING_MUTATION, variables: { listingId } })
      const payload = data?.importJobBoardListing
      if (!payload?.job || payload.errors.length) {
        setErrors(payload?.errors.length ? payload.errors : ['Could not save this job. Please try again.'])
        return null
      }
      // The private list may already be cached from an earlier visit.
      client.cache.evict({ id: 'ROOT_QUERY', fieldName: 'jobs' })
      return { jobId: payload.job.id, warnings: payload.warnings }
    } catch (error) {
      setErrors([requestErrorMessage(error, 'Could not save this job. Please try again.')])
      return null
    } finally {
      setBusyId(null)
    }
  }

  return { save, busyId, errors }
}
