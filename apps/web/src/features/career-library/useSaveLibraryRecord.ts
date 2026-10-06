/**
 * Description: Runs one career-library save mutation and refetches the library.
 * Index:
 *   - useSaveLibraryRecord: returns save, busy, errors, and clearErrors
 */
import { useState } from 'react'
import type { DocumentNode } from 'graphql'
import { useApolloClient } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { CAREER_LIBRARY_QUERY } from './careerLibraryOperations'

type MutationPayloads = Record<string, { errors: string[] } | null>

/** Runs `save`; it resolves to true when the mutation returned no errors. */
export function useSaveLibraryRecord() {
  const client = useApolloClient()
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  /** Runs the mutation, refetches the library, and keeps validation errors for the dialog. */
  async function save(mutation: DocumentNode, variables: Record<string, unknown>): Promise<boolean> {
    setBusy(true)
    setErrors([])
    try {
      const { data } = await client.mutate<MutationPayloads>({
        mutation,
        variables,
        refetchQueries: [CAREER_LIBRARY_QUERY],
        awaitRefetchQueries: true,
      })
      const payload = Object.values(data ?? {})[0]
      if (payload && payload.errors.length === 0) return true
      setErrors(payload?.errors.length ? payload.errors : ['That didn’t work. Please try again.'])
    } catch (error) {
      setErrors([requestErrorMessage(error, 'Could not reach the server. Please try again.')])
    } finally {
      setBusy(false)
    }
    return false
  }

  return { save, busy, errors, clearErrors: () => setErrors([]) }
}
