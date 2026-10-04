/**
 * Description: Hook that loads the signed-in user's profile and career library.
 * Index:
 *   - useCareerLibrary: returns the library data plus loading and error state
 */
import { useQuery } from '@apollo/client/react'
import { CAREER_LIBRARY_QUERY } from './careerLibraryOperations'

/** Fetches the library, always refreshing from the server so a just-finished import shows up. */
export function useCareerLibrary() {
  const { data, loading, error } = useQuery(CAREER_LIBRARY_QUERY, { fetchPolicy: 'cache-and-network' })
  return { library: data ?? null, loading, error }
}
