/**
 * Description: Follows the signed-in user's monthly cost summary without polling.
 * Index:
 *   - useAiUsage: current summary and connection errors
 */
import { useQuery, useSubscription } from '@apollo/client/react'
import { AI_USAGE_OWNER, AI_USAGE_UPDATED } from './aiUsageOperations'

/** Loads the owner, then receives the current summary and later accounting updates. */
export function useAiUsage() {
  const owner = useQuery(AI_USAGE_OWNER)
  const userId = owner.data?.me.id ?? ''
  const updates = useSubscription(AI_USAGE_UPDATED, {
    variables: { userId },
    skip: !userId,
  })
  return { usage: updates.data?.aiUsageUpdated, error: owner.error ?? updates.error }
}
