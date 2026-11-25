/** "Plan & billing" (`/account/billing`): says which plan the user is on and the date that matters
 * (trial end, renewal, or the end of a cancelling plan). Shows dates only, never usage or limits.
 * Trial and ended users get an Upgrade button that sends them to Stripe Checkout; after paying, the
 * page refetches the plan for a short while until the Stripe webhook has made it Paid (Upgrade is
 * disabled meanwhile, so a second subscription can't be started).
 * Users with a Stripe customer also get Manage billing, which opens the Stripe Customer Portal. When the
 * last charge failed (Stripe is retrying), the plan says so and Manage billing becomes the main action. */
import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client/react'
import { useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { ErrorAlert } from '@/components/ErrorAlert'
import { PageHeading } from '@/components/PageHeading'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import type { BillingQuery } from '@/graphql/generated/graphql'
import { BILLING_QUERY, START_BILLING_CHECKOUT_MUTATION, START_BILLING_PORTAL_MUTATION } from './billingOperations'

const PLAN_REFETCH_INTERVAL_MS = 2000
const PLAN_REFETCH_ATTEMPTS = 10
const BILLING_UNAVAILABLE = "Billing isn't available right now."

type Billing = BillingQuery['me']['billing']

const formatDate = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString('en-US', { dateStyle: 'medium' }) : 'soon'

/** One plain sentence for the plan; the date that matters depends on the state.
 * `label` is the short status tag and `dot` the signal colour shown beside it. */
function planSummary(billing: Billing) {
  if (billing.plan === 'TRIAL') return { label: 'Trial', dot: 'is-wait', title: `Free trial — ends ${formatDate(billing.trialEndsAt)}`, detail: 'You can use every feature until then.' }
  if (billing.plan === 'PAID' && billing.paymentFailed) return { label: 'Payment failed', dot: 'is-action', title: "Your last payment didn't go through", detail: "We'll try your card again automatically. Update your card to keep your subscription." }
  if (billing.plan === 'PAID' && billing.cancelAtPeriodEnd) return { label: 'Cancelling', dot: 'is-wait', title: `Ends ${formatDate(billing.currentPeriodEndsAt)}`, detail: 'Your subscription is cancelled. You keep access until then.' }
  if (billing.plan === 'PAID') return { label: 'Active', dot: 'is-done', title: `Renews ${formatDate(billing.currentPeriodEndsAt)}`, detail: 'Your subscription is active.' }
  return { label: 'Ended', dot: 'is-action', title: 'Your free trial has ended', detail: 'Your saved jobs, library and resumes are still here. AI features are paused.' }
}

/** After Checkout, refetch the plan every few seconds (bounded) until the webhook makes it Paid. */
function useRefetchPlanAfterCheckout(returning: boolean, plan: string | undefined, refetch: () => unknown) {
  const [gaveUp, setGaveUp] = useState(false)
  const waiting = returning && plan !== undefined && plan !== 'PAID'
  useEffect(() => {
    if (!waiting) return
    let attempts = 0
    const timer = setInterval(() => {
      attempts += 1
      void refetch()
      if (attempts >= PLAN_REFETCH_ATTEMPTS) {
        clearInterval(timer)
        setGaveUp(true)
      }
    }, PLAN_REFETCH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [waiting, refetch])
  return { waiting, gaveUp }
}

/** Runs a Stripe session mutation and sends the browser to the returned URL; otherwise reports the errors. */
async function redirectToStripe<Data>(
  run: () => Promise<{ data?: Data | null }>,
  payloadOf: (data: Data | null | undefined) => { url?: string | null; errors: string[] } | null | undefined,
  setErrors: (errors: string[]) => void,
) {
  setErrors([])
  try {
    const { data } = await run()
    const payload = payloadOf(data)
    if (payload?.url) window.location.href = payload.url
    else setErrors(payload?.errors.length ? payload.errors : [BILLING_UNAVAILABLE])
  } catch (caught) {
    setErrors([requestErrorMessage(caught, BILLING_UNAVAILABLE)])
  }
}

export function BillingPage() {
  const { data, loading, error, refetch } = useQuery(BILLING_QUERY)
  const [startCheckout, { loading: starting }] = useMutation(START_BILLING_CHECKOUT_MUTATION)
  const [startPortal, { loading: openingPortal }] = useMutation(START_BILLING_PORTAL_MUTATION)
  const [checkoutErrors, setCheckoutErrors] = useState<string[]>([])
  const [portalErrors, setPortalErrors] = useState<string[]>([])
  const [params] = useSearchParams()
  const plan = data?.me.billing.plan
  const priceLabel = data?.me.billing.priceLabel
  const { waiting, gaveUp } = useRefetchPlanAfterCheckout(params.get('checkout') === 'success', plan, refetch)
  const summary = data ? planSummary(data.me.billing) : null

  const upgrade = () => redirectToStripe(startCheckout, (data) => data?.startBillingCheckout, setCheckoutErrors)
  const manageBilling = () => redirectToStripe(startPortal, (data) => data?.startBillingPortal, setPortalErrors)
  return (
    <div className="account-security-page">
      <PageHeading title="Plan & billing" description="Your plan and when it changes." />
      {error && <ErrorAlert title="Couldn't load your plan" messages={[requestErrorMessage(error, error.message)]} />}
      {loading && !data && <p className="text-muted-foreground">Loading your plan…</p>}
      {summary && (
        <section aria-labelledby="current-plan-title" className="billing-plan">
          <h2 id="current-plan-title" className="billing-plan-label">
            <span className={`signal-dot ${summary.dot}`} aria-hidden="true" />
            Current plan · {summary.label}
          </h2>
          <p className="billing-plan-title">{summary.title}</p>
          <p className="billing-plan-detail">{summary.detail}</p>
          {waiting && (
            <p role="status" className="billing-plan-status">
              <span className={`signal-dot mt-1 ${gaveUp ? 'is-action' : 'is-wait'}`} aria-hidden="true" />
              {gaveUp ? 'Your payment is taking longer than usual to show up. Refresh this page in a minute.' : 'Payment received — updating your plan…'}
            </p>
          )}
          {(plan === 'TRIAL' || plan === 'ENDED') && (
            <div className="billing-plan-action">
              <Button size="lg" onClick={upgrade} disabled={starting || waiting}>{starting ? 'Opening checkout…' : 'Upgrade'}</Button>
              {priceLabel && <span className="billing-plan-price">{priceLabel}</span>}
            </div>
          )}
          <ErrorAlert title="Couldn't open checkout" messages={checkoutErrors} />
          {data?.me.billing.canManageBilling && (
            <div className="billing-manage">
              <div>
                <p className="billing-manage-title">{data.me.billing.paymentFailed ? 'Update your card' : 'Card and invoices'}</p>
                <p className="billing-manage-detail">{data.me.billing.paymentFailed ? 'Add a working card so the next retry goes through.' : 'Update your card, see invoices or cancel.'}</p>
              </div>
              <Button variant={data.me.billing.paymentFailed ? 'default' : 'outline'} onClick={manageBilling} disabled={openingPortal}>{openingPortal ? 'Opening billing…' : 'Manage billing'}</Button>
              <ErrorAlert title="Couldn't open billing" messages={portalErrors} />
            </div>
          )}
        </section>
      )}
    </div>
  )
}
