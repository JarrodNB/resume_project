/** The Plan & billing link appears only for a plan-ended code. */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { MutationErrorAlert, PlanEndedFailureLink } from './PlanBillingLink'

describe('MutationErrorAlert', () => {
  it('links to billing when the mutation returned PLAN_ENDED', () => {
    render(<MemoryRouter><MutationErrorAlert errors={['Subscribe to keep going.']} errorCode="PLAN_ENDED" /></MemoryRouter>)
    expect(screen.getByText('Subscribe to keep going.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Plan & billing' })).toHaveAttribute('href', '/account/billing')
  })

  it('adds no link for other or missing codes, even with the same message', () => {
    render(<MemoryRouter><MutationErrorAlert errors={['Your free trial has ended. Subscribe to keep using AI features.']} errorCode={null} /></MemoryRouter>)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('PlanEndedFailureLink', () => {
  it('gives the billing link only for the plan_ended failure code', () => {
    const { rerender } = render(<MemoryRouter><PlanEndedFailureLink failureCode="plan_ended" /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Plan & billing' })).toBeInTheDocument()
    rerender(<MemoryRouter><PlanEndedFailureLink failureCode="execution_failed" /></MemoryRouter>)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    rerender(<MemoryRouter><PlanEndedFailureLink failureCode={null} /></MemoryRouter>)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
