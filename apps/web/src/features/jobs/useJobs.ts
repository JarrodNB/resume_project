/**
 * Description: Hooks that load saved jobs.
 * Index:
 *   - useJobs: the user's jobs plus loading and error state
 *   - useJob: one job plus loading, error state, and an explicit reload
 */
import { useQuery } from '@apollo/client/react'
import { JOB_QUERY, JOBS_QUERY } from './jobsOperations'

/** Fetches the job list, always refreshing so a just-scraped job shows up. */
export function useJobs() {
  const { data, loading, error } = useQuery(JOBS_QUERY, { fetchPolicy: 'cache-and-network' })
  return { jobs: data?.jobs ?? null, loading, error }
}

/** Fetches one of the user's jobs by id. */
export function useJob(id: string) {
  const { data, loading, error, refetch } = useQuery(JOB_QUERY, { variables: { id } })
  return { job: data?.job ?? null, loading, error, refresh: refetch }
}
