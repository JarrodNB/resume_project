/** Reads saved skills for Fit and job-board views, refreshing on mount and observing library cache edits. */
import { useQuery } from '@apollo/client/react'
import { SKILL_MATCHES_QUERY } from './skillMatchesOperations'

export function useSkillMatches(enabled: boolean) {
  return useQuery(SKILL_MATCHES_QUERY, { fetchPolicy: 'cache-and-network', skip: !enabled })
}
