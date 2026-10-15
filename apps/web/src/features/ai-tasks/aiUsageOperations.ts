/**
 * Description: Current owner and live monthly AI cost summary operations.
 * Index:
 *   - AI_USAGE_OWNER: current user's identity for the authorized subscription
 *   - AI_USAGE_UPDATED: known spend, budget and incomplete accounting updates
 */
import { graphql } from '@/graphql/generated'

export const AI_USAGE_OWNER = graphql(`
  query AiUsageOwner {
    me { id }
  }
`)

export const AI_USAGE_UPDATED = graphql(`
  subscription AiUsageUpdated($userId: ID!) {
    aiUsageUpdated(userId: $userId) {
      spentThisMonthUsd
      monthlyBudgetUsd
      incompleteAttempts
      resetsAt
    }
  }
`)
