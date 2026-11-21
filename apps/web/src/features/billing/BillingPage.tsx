/** "Plan & billing" (`/account/billing`): says which plan the user is on and the date that matters
 * (trial end, renewal, or the end of a cancelling plan). Shows dates only, never usage or limits.
 * Trial and ended users get an Upgrade button that sends them to Stripe Checkout; after paying, the
 * page refetches the plan for a short while until the Stripe webhook has made it Paid (Upgrade is
 * disabled meanwhile, so a second subscription can't be started).
 * Users with a Stripe customer also get Manage billing, which opens the Stripe Customer Portal. */
import { useEffect, useRef, useState } from 'react'
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

/** After Checkout, refetch the plan every few seconds (bounded) until the webhook makes it Paid. */
function useRefetchPlanAfterCheckout(returning: boolean, plan: string | undefined, refetch: () => unknown) {
  const [gaveUp, setGaveUp] = useState(false)
  const refetchRef = useRef(refetch)
  refetchRef.current = refetch
  const waiting = returning && plan !== undefined && plan !== 'PAID'
  useEffect(() => {
    if (!waiting) return
    let attempts = 0
    const timer = setInterval(() => {
      attempts += 1
      void refetchRef.current()
      if (attempts >= PLAN_REFETCH_ATTEMPTS) {
        clearInterval(timer)
        setGaveUp(true)
      }
    }, PLAN_REFETCH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [waiting])
  return { waiting, gaveUp }
}

export function BillingPage() {
  const { data, loading, error, refetch } = useQuery(BILLING_QUERY)
  const [startCheckout, { loading: starting }] = useMutation(START_BILLING_CHECKOUT_MUTATION)
  const [startPortal, { loading: openingPortal }] = useMutation(START_BILLING_PORTAL_MUTATION)
  const [checkoutErrors, setCheckoutErrors] = useState<string[]>([])
  const [portalErrors, setPortalErrors] = useState<string[]>([])
  const [params] = useSearchParams()
  const plan = data?.me.billing.plan
  const { waiting, gaveUp } = useRefetchPlanAfterCheckout(params.get('checkout') === 'success', plan, refetch)
  const summary = data ? planSummary(data.me.billing) : null

  async function upgrade() {
    setCheckoutErrors([])
    try {
      const { data: result } = await startCheckout()
      const payload = result?.startBillingCheckout
      if (payload?.url) window.location.href = payload.url
      else setCheckoutErrors(payload?.errors.length ? payload.errors : ["Billing isn't available right now."])
    } catch (caught) {
      setCheckoutErrors([requestErrorMessage(caught, "Billing isn't available right now.")])
    }
  }

  async function manageBilling() {
    setPortalErrors([])
    try {
      const { data: result } = await startPortal()
      const payload = result?.startBillingPortal
      if (payload?.url) window.location.href = payload.url
      else setPortalErrors(payload?.errors.length ? payload.errors : ["Billing isn't available right now."])
    } catch (caught) {
      setPortalErrors([requestErrorMessage(caught, "Billing isn't available right now.")])
    }
  }
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
          {waiting && (
            <p role="status" className="mt-3 text-sm">
              {gaveUp ? 'Your payment is taking longer than usual to show up. Refresh this page in a minute.' : 'Payment received — updating your plan…'}
            </p>
          )}
          {(plan === 'TRIAL' || plan === 'ENDED') && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={upgrade} disabled={starting || waiting}>{starting ? 'Opening checkout…' : 'Upgrade'}</Button>
              <span className="text-sm text-muted-foreground">$12/month</span>
            </div>
          )}
          <ErrorAlert messages={checkoutErrors} />
          {data?.me.billing.canManageBilling && (
            <div className="mt-4">
              <Button variant="outline" onClick={manageBilling} disabled={openingPortal}>{openingPortal ? 'Opening billing…' : 'Manage billing'}</Button>
              <p className="mt-1 text-sm text-muted-foreground">Update your card, see invoices or cancel.</p>
              <ErrorAlert messages={portalErrors} />
            </div>
          )}
        </section>
      )}
    </div>
  )
}
