/** The signed-in user's plan and its dates (never usage, limits or spend). */
import { graphql } from '@/graphql/generated'

export const BILLING_QUERY = graphql(`
  query Billing {
    me { id billing { plan trialEndsAt currentPeriodEndsAt cancelAtPeriodEnd canManageBilling } }
  }
`)

/** Asks Rails for a Stripe Checkout page to send the user to. */
export const START_BILLING_CHECKOUT_MUTATION = graphql(`
  mutation StartBillingCheckout {
    startBillingCheckout(input: {}) { url errors }
  }
`)

/** Asks Rails for a Stripe Customer Portal page (card, invoices, cancel) to send the user to. */
export const START_BILLING_PORTAL_MUTATION = graphql(`
  mutation StartBillingPortal {
    startBillingPortal(input: {}) { url errors }
  }
`)
