/**
 * Description: Runs one job mutation and refetches the job list and the open job.
 * Index:
 *   - useSaveJob: returns save, busy, errors, and clearErrors
 */
import { useState } from 'react'
import type { DocumentNode, OperationDefinitionNode } from 'graphql'
import { useApolloClient } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { JOB_QUERY, JOBS_QUERY } from './jobsOperations'

type MutationPayload = { errors: string[]; job?: { id: string } | null } | null

/** The operation name on a document, used to see which job queries are on screen. */
function operationName(document: DocumentNode) {
  const operation = document.definitions.find((definition): definition is OperationDefinitionNode => definition.kind === 'OperationDefinition')
  return operation?.name?.value
}

interface SaveResult {
  ok: boolean
  jobId: string | null
}

/** Runs `save`; it resolves to ok when the mutation returned no errors. */
export function useSaveJob() {
  const client = useApolloClient()
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  /** Runs the mutation and refetches the job queries that are on screen. Pass `refetch` to
   * choose which ones; an empty list skips the refetch. */
  async function save(
    mutation: DocumentNode,
    variables: Record<string, unknown>,
    refetch: DocumentNode[] = [JOBS_QUERY, JOB_QUERY],
  ): Promise<SaveResult> {
    setBusy(true)
    setErrors([])
    try {
      const watched = new Set([...client.getObservableQueries('active')].map((query) => query.queryName))
      const refetchQueries = refetch.filter((query) => watched.has(operationName(query)))
      const { data } = await client.mutate<Record<string, MutationPayload>>({
        mutation,
        variables,
        refetchQueries,
        awaitRefetchQueries: true,
      })
      const payload = Object.values(data ?? {})[0]
      if (payload && payload.errors.length === 0) return { ok: true, jobId: payload.job?.id ?? null }
      setErrors(payload?.errors.length ? payload.errors : ['That didn’t work. Please try again.'])
    } catch (error) {
      setErrors([requestErrorMessage(error, 'Could not reach the server. Please try again.')])
    } finally {
      setBusy(false)
    }
    return { ok: false, jobId: null }
  }

  return { save, busy, errors, clearErrors: () => setErrors([]) }
}
