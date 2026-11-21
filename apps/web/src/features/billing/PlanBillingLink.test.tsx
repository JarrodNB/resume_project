/** The interview failure hint appears only for a plan-ended failure code. */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { MutationErrorAlert, PlanEndedFailureLink, PlanEndedHint } from './PlanBillingLink'

it('links to billing when the failure code is plan_ended', () => {
  render(<MemoryRouter><PlanEndedHint failureCode="plan_ended" /></MemoryRouter>)
  expect(screen.getByRole('link', { name: 'Plan & billing' })).toHaveAttribute('href', '/account/billing')
})

it('shows nothing for other failure codes', () => {
  const { container } = render(<MemoryRouter><PlanEndedHint failureCode="execution_failed" /></MemoryRouter>)
  expect(container).toBeEmptyDOMElement()
})

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
