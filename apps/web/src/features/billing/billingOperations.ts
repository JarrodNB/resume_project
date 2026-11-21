/** The signed-in user's plan and its dates (never usage, limits or spend). */
import { graphql } from '@/graphql/generated'

export const BILLING_QUERY = graphql(`
  query Billing {
    me { id billing { plan trialEndsAt currentPeriodEndsAt cancelAtPeriodEnd } }
  }
`)
