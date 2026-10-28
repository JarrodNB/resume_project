/** Archives a saved job and removes it from cached Jobs and Home lists without deleting its data. */
import type { Reference } from '@apollo/client'
import { useApolloClient } from '@apollo/client/react'
import { ARCHIVE_JOB_MUTATION } from './jobsOperations'
import { useSaveJob } from './useSaveJob'

export function useArchiveJob() {
  const client = useApolloClient()
  const { save, ...state } = useSaveJob()

  async function archive(jobId: string) {
    const result = await save(ARCHIVE_JOB_MUTATION, { id: jobId }, [])
    if (!result.ok) return false
    client.cache.modify({
      fields: {
        jobs(existing, { readField }) {
          return Array.isArray(existing) ? existing.filter((job) => readField('id', job) !== jobId) : existing
        },
        jobPipeline(existing, { readField }) {
          return Array.isArray(existing)
            ? existing.filter((entry) => readField('id', readField<Reference>('job', entry)) !== jobId)
            : existing
        },
      },
    })
    return true
  }

  return { archive, ...state }
}
