/** The interview failure hint appears only for a plan-ended failure code. */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, it } from 'vitest'
import { PlanEndedHint } from './PlanBillingLink'

it('links to billing when the failure code is plan_ended', () => {
  render(<MemoryRouter><PlanEndedHint failureCode="plan_ended" /></MemoryRouter>)
  expect(screen.getByRole('link', { name: 'Plan & billing' })).toHaveAttribute('href', '/account/billing')
})

it('shows nothing for other failure codes', () => {
  const { container } = render(<MemoryRouter><PlanEndedHint failureCode="execution_failed" /></MemoryRouter>)
  expect(container).toBeEmptyDOMElement()
})
