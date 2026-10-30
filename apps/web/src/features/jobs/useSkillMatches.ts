/** Keeps saved skills fresh when Fit opens and when library writes update Apollo's cache. */
import { useQuery } from '@apollo/client/react'
import { SKILL_MATCHES_QUERY } from './skillMatchesOperations'

export function useSkillMatches(hasDescription: boolean) {
  return useQuery(SKILL_MATCHES_QUERY, { fetchPolicy: 'cache-and-network', skip: !hasDescription })
}
