/** Reads a bounded owned list when the start route mounts; opening a session uses live snapshots. */
import { useQuery } from '@apollo/client/react'
import { RECENT_INTERVIEWS } from './interviewOperations'

export function useRecentInterviews() {
  const { data, loading, error, refetch } = useQuery(RECENT_INTERVIEWS, { fetchPolicy: 'network-only' })
  return { interviews: data?.recentInterviewSessions ?? [], loading, error, refresh: () => refetch() }
}
