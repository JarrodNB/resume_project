/** Saves a listing through Rails. A synchronous lock prevents repeated clicks while saving. */
import { useRef, useState } from 'react'
import { useApolloClient } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { IMPORT_JOB_BOARD_LISTING_MUTATION } from './jobBoardOperations'

export function useImportJobBoardListing() {
  const client = useApolloClient()
  const saving = useRef(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])

  async function save(listingId: string) {
    if (saving.current) return null
    saving.current = true
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
      saving.current = false
      setBusyId(null)
    }
  }

  return { save, busyId, errors }
}
