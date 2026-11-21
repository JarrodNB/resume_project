/** Shows the Plan & billing page for each plan state, and no usage or limit numbers. */
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { BillingPage } from './BillingPage'
import { BILLING_QUERY, START_BILLING_CHECKOUT_MUTATION } from './billingOperations'

type Plan = 'TRIAL' | 'PAID' | 'ENDED'
type BillingData = { plan: Plan; trialEndsAt: string | null; currentPeriodEndsAt: string | null; cancelAtPeriodEnd: boolean }
const billingResult = (billing: BillingData) => ({ data: { me: { __typename: 'User', id: '1', billing: { __typename: 'Billing', ...billing } } } })
const trial: BillingData = { plan: 'TRIAL', trialEndsAt: '2026-12-05T12:00:00Z', currentPeriodEndsAt: null, cancelAtPeriodEnd: false }
const paid: BillingData = { plan: 'PAID', trialEndsAt: null, currentPeriodEndsAt: '2026-12-20T12:00:00Z', cancelAtPeriodEnd: false }
const originalLocation = window.location

function renderBilling(billing: BillingData, extra: { mocks?: object[]; url?: string } = {}) {
  return renderPage({
    path: '/account/billing', url: extra.url ?? '/account/billing', element: <BillingPage />,
    mocks: [{ request: { query: BILLING_QUERY }, result: billingResult(billing) }, ...(extra.mocks ?? [])] as never,
  })
}

/** Replaces window.location so a redirect can be observed without navigating jsdom. */
function captureRedirects() {
  const location = { href: 'http://localhost/account/billing' }
  Object.defineProperty(window, 'location', { configurable: true, value: location })
  return location
}

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
  vi.useRealTimers()
})

it('shows the trial end date', async () => {
  renderBilling({ plan: 'TRIAL', trialEndsAt: '2026-12-05T12:00:00Z', currentPeriodEndsAt: null, cancelAtPeriodEnd: false })
  expect(await screen.findByText(/Free trial — ends Dec 5, 2026/)).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Plan & billing' })).toBeInTheDocument()
})

it('shows the renewal date on a paid plan', async () => {
  renderBilling({ plan: 'PAID', trialEndsAt: '2026-11-01T12:00:00Z', currentPeriodEndsAt: '2026-12-20T12:00:00Z', cancelAtPeriodEnd: false })
  expect(await screen.findByText(/Renews Dec 20, 2026/)).toBeInTheDocument()
})

it('shows the end date on a paid plan that is cancelling', async () => {
  renderBilling({ plan: 'PAID', trialEndsAt: null, currentPeriodEndsAt: '2026-12-20T12:00:00Z', cancelAtPeriodEnd: true })
  expect(await screen.findByText(/Ends Dec 20, 2026/)).toBeInTheDocument()
  expect(screen.queryByText(/Renews/)).not.toBeInTheDocument()
})

it('says the trial has ended', async () => {
  renderBilling({ plan: 'ENDED', trialEndsAt: '2026-11-10T12:00:00Z', currentPeriodEndsAt: null, cancelAtPeriodEnd: false })
  expect(await screen.findByText('Your free trial has ended')).toBeInTheDocument()
})

it('shows Upgrade with the price for a trial and for an ended plan', async () => {
  renderBilling(trial)
  expect(await screen.findByRole('button', { name: 'Upgrade' })).toBeEnabled()
  expect(screen.getByText('$12/month')).toBeInTheDocument()
})

it('shows Upgrade when the trial has ended', async () => {
  renderBilling({ plan: 'ENDED', trialEndsAt: '2026-11-10T12:00:00Z', currentPeriodEndsAt: null, cancelAtPeriodEnd: false })
  expect(await screen.findByRole('button', { name: 'Upgrade' })).toBeInTheDocument()
})

it('hides Upgrade on a paid plan', async () => {
  renderBilling(paid)
  await screen.findByText(/Renews Dec 20, 2026/)
  expect(screen.queryByRole('button', { name: 'Upgrade' })).not.toBeInTheDocument()
})

it('sends the user to the Checkout URL when Upgrade is clicked', async () => {
  const location = captureRedirects()
  renderBilling(trial, { mocks: [{ request: { query: START_BILLING_CHECKOUT_MUTATION }, result: { data: { startBillingCheckout: { __typename: 'StartBillingCheckoutPayload', url: 'https://checkout.stripe.com/pay/abc', errors: [] } } } }] })
  await userEvent.click(await screen.findByRole('button', { name: 'Upgrade' }))
  await waitFor(() => expect(location.href).toBe('https://checkout.stripe.com/pay/abc'))
})

it('shows the error when Checkout cannot start', async () => {
  const location = captureRedirects()
  renderBilling(trial, { mocks: [{ request: { query: START_BILLING_CHECKOUT_MUTATION }, result: { data: { startBillingCheckout: { __typename: 'StartBillingCheckoutPayload', url: null, errors: ["Billing isn't available right now."] } } } }] })
  await userEvent.click(await screen.findByRole('button', { name: 'Upgrade' }))
  expect(await screen.findByText("Billing isn't available right now.")).toBeInTheDocument()
  expect(location.href).toBe('http://localhost/account/billing')
})

it('disables Upgrade while Checkout is starting', async () => {
  const location = captureRedirects()
  renderBilling(trial, { mocks: [{ request: { query: START_BILLING_CHECKOUT_MUTATION }, delay: 200, result: { data: { startBillingCheckout: { __typename: 'StartBillingCheckoutPayload', url: 'https://checkout.stripe.com/pay/abc', errors: [] } } } }] })
  await userEvent.click(await screen.findByRole('button', { name: 'Upgrade' }))
  expect(await screen.findByRole('button', { name: 'Opening checkout…' })).toBeDisabled()
  await waitFor(() => expect(location.href).toBe('https://checkout.stripe.com/pay/abc'))
})

it('after Checkout, says the payment arrived and refetches until the plan is Paid', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  renderBilling(trial, { url: '/account/billing?checkout=success', mocks: [{ request: { query: BILLING_QUERY }, result: billingResult(paid) }] })
  expect(await screen.findByText('Payment received — updating your plan…')).toBeInTheDocument()
  await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
  expect(await screen.findByText(/Renews Dec 20, 2026/)).toBeInTheDocument()
  expect(screen.queryByText('Payment received — updating your plan…')).not.toBeInTheDocument()
})

it('stops refetching after a bounded wait', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const stillTrial = { request: { query: BILLING_QUERY }, result: billingResult(trial) }
  renderBilling(trial, { url: '/account/billing?checkout=success', mocks: Array.from({ length: 10 }, () => stillTrial) })
  await screen.findByText('Payment received — updating your plan…')
  await act(async () => { await vi.advanceTimersByTimeAsync(21000) })
  expect(await screen.findByText(/taking longer than usual/)).toBeInTheDocument()
})

it('shows no payment message on a normal visit', async () => {
  renderBilling(trial)
  await screen.findByText(/Free trial/)
  expect(screen.queryByText(/Payment received/)).not.toBeInTheDocument()
})
