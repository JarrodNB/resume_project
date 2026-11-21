/** "Plan & billing" (`/account/billing`): says which plan the user is on and the date that matters
 * (trial end, renewal, or the end of a cancelling plan). Shows dates only, never usage or limits.
 * Upgrade and Manage billing buttons will go in the marked spot once Stripe is wired in. */
import { useQuery } from '@apollo/client/react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { PageHeading } from '@/components/PageHeading'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import type { BillingQuery } from '@/graphql/generated/graphql'
import { BILLING_QUERY } from './billingOperations'

type Billing = BillingQuery['me']['billing']

const formatDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString('en-US', { dateStyle: 'medium' }) : 'soon'

/** One plain sentence for the plan; the date that matters depends on the state. */
function planSummary(billing: Billing) {
  if (billing.plan === 'TRIAL') return { title: `Free trial — ends ${formatDate(billing.trialEndsAt)}`, detail: 'You can use every feature until then.' }
  if (billing.plan === 'PAID' && billing.cancelAtPeriodEnd) return { title: `Ends ${formatDate(billing.currentPeriodEndsAt)}`, detail: 'Your subscription is cancelled. You keep access until then.' }
  if (billing.plan === 'PAID') return { title: `Renews ${formatDate(billing.currentPeriodEndsAt)}`, detail: 'Your subscription is active.' }
  return { title: 'Your free trial has ended', detail: 'Your saved jobs, library and resumes are still here. AI features are paused.' }
}

export function BillingPage() {
  const { data, loading, error } = useQuery(BILLING_QUERY)
  const summary = data ? planSummary(data.me.billing) : null
  return (
    <div className="account-security-page">
      <PageHeading title="Plan & billing" description="Your plan and when it changes." />
      {error && <ErrorAlert title="Couldn't load your plan" messages={[requestErrorMessage(error, error.message)]} />}
      {loading && !data && <p className="text-muted-foreground">Loading your plan…</p>}
      {summary && (
        <section aria-labelledby="current-plan-title" className="security-password-section">
          <h2 id="current-plan-title" className="mb-2 text-xl font-semibold tracking-tight">Current plan</h2>
          <p className="text-lg font-medium">{summary.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{summary.detail}</p>
          {/* Upgrade (ticket 03) and Manage billing (ticket 04) buttons go here. */}
        </section>
      )}
    </div>
  )
}
