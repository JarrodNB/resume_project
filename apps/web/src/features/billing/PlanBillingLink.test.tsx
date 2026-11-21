/** The interview failure hint appears only for a plan-ended failure code. */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { MutationErrorAlert, PlanEndedHint, planEndedFailureAction } from './PlanBillingLink'

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

describe('planEndedFailureAction', () => {
  it('gives the billing link only for the plan_ended failure code', () => {
    expect(planEndedFailureAction('plan_ended')).toBeTruthy()
    expect(planEndedFailureAction('execution_failed')).toBeUndefined()
    expect(planEndedFailureAction(null)).toBeUndefined()
  })
})
