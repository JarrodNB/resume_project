/** Checks the public terms and privacy pages explain paid subscriptions and Stripe. */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { PrivacyPolicyPage } from './PrivacyPolicyPage'
import { TermsPage } from './TermsPage'

function renderPage(page: React.ReactElement) {
  return render(<MemoryRouter>{page}</MemoryRouter>)
}

describe('TermsPage', () => {
  it('explains the free trial, the monthly price and how to cancel', () => {
    renderPage(<TermsPage />)
    expect(screen.getByRole('heading', { name: 'Subscription and billing' })).toBeInTheDocument()
    const text = document.body.textContent ?? ''
    expect(text).toContain('7-day free trial')
    expect(text).toContain('$12 per month')
    expect(text).toContain('Stripe')
    expect(text).toContain('no refunds for partial months')
    expect(text).toContain('saved work stays available')
  })

  it('shows the new effective date', () => {
    renderPage(<TermsPage />)
    expect(screen.getByText('Effective November 21, 2026')).toBeInTheDocument()
  })
})

describe('PrivacyPolicyPage', () => {
  it('names Stripe as the payment processor and says what we store', () => {
    renderPage(<PrivacyPolicyPage />)
    const text = document.body.textContent ?? ''
    expect(screen.getByText('Stripe', { selector: 'strong' })).toBeInTheDocument()
    expect(text).toContain('never see your full card number')
    expect(text).toContain('Stripe customer and subscription identifiers')
  })
})
