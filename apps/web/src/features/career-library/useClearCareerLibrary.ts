/**
 * Description: Hook that empties the career library, then refetches it.
 * Index:
 *   - useClearCareerLibrary: returns clearLibrary(), busy, and errors
 */
import { useState } from 'react'
import { useApolloClient } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { CAREER_LIBRARY_QUERY } from './careerLibraryOperations'
import { CLEAR_CAREER_LIBRARY_MUTATION } from './careerLibraryMutations'

/** Runs clearCareerLibrary; resolves to true when the library was emptied. */
export function useClearCareerLibrary() {
  const client = useApolloClient()
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  /** Empties the library and refetches the page. */
  async function clearLibrary(): Promise<boolean> {
    setBusy(true)
    setErrors([])
    try {
      const { data } = await client.mutate({
        mutation: CLEAR_CAREER_LIBRARY_MUTATION,
        refetchQueries: [CAREER_LIBRARY_QUERY],
        awaitRefetchQueries: true,
      })
      const payload = data?.clearCareerLibrary
      if (payload && payload.errors.length === 0) return true
      setErrors(payload?.errors.length ? payload.errors : ['That didn’t work. Please try again.'])
    } catch (error) {
      setErrors([requestErrorMessage(error, 'Could not reach the server. Please try again.')])
    } finally {
      setBusy(false)
    }
    return false
  }

  return { clearLibrary, busy, errors, clearErrors: () => setErrors([]) }
}
