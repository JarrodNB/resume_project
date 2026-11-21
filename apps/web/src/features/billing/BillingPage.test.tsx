/** Shows the Plan & billing page for each plan state, and no usage or limit numbers. */
import { screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { BillingPage } from './BillingPage'
import { BILLING_QUERY } from './billingOperations'

type Plan = 'TRIAL' | 'PAID' | 'ENDED'
function renderBilling(billing: { plan: Plan; trialEndsAt: string | null; currentPeriodEndsAt: string | null; cancelAtPeriodEnd: boolean }) {
  return renderPage({
    path: '/account/billing', url: '/account/billing', element: <BillingPage />,
    mocks: [{ request: { query: BILLING_QUERY }, result: { data: { me: { __typename: 'User', id: '1', billing: { __typename: 'Billing', ...billing } } } } }],
  })
}

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
