/**
 * Description: Hooks that load saved resumes.
 * Index:
 *   - useResumes: the user's resumes plus loading and error state
 *   - useResume: one resume plus loading and error state
 */
import { useQuery } from '@apollo/client/react'
import { RESUME_QUERY, RESUMES_QUERY } from './resumesOperations'

/** Fetches the resume list, always refreshing so a just-saved resume shows up. */
export function useResumes() {
  const { data, loading, error } = useQuery(RESUMES_QUERY, { fetchPolicy: 'cache-and-network' })
  return { resumes: data?.resumes ?? null, loading, error }
}

/** Fetches one of the user's resumes by id. */
export function useResume(id: string) {
  const { data, loading, error, refetch } = useQuery(RESUME_QUERY, { variables: { id } })
  return { resume: data?.resume ?? null, loading, error, refetch }
}
