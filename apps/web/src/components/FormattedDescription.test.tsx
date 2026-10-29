import { render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { FormattedDescription } from './FormattedDescription'

it('shows labels, bullet lists, and paragraphs from plain-text descriptions', () => {
  render(
    <FormattedDescription text={'Position: Staff Engineer\n\nDuties:\n- Review code.\n• Fix defects.\n\nBenefits:\nMedical coverage.\nDental too.'} />,
  )

  expect(screen.getByText('Position: Staff Engineer').tagName).toBe('P')
  expect(screen.getByText('Duties:')).toHaveClass('font-semibold')
  expect(within(screen.getByRole('list')).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Review code.', 'Fix defects.'])
  expect(screen.getByText('Benefits:')).toHaveClass('font-semibold')
  expect(screen.getByText((_, element) => element?.textContent === 'Medical coverage.\nDental too.')).toHaveClass('whitespace-pre-line')
})

it('keeps a lone label-like line and markup as plain text', () => {
  const { container } = render(<FormattedDescription text={'<b>Ships</b> daily: yes\n\nRequirements:\n\n- Ruby'} />)

  expect(screen.getByText('<b>Ships</b> daily: yes')).not.toHaveClass('font-semibold')
  expect(screen.getByText('Requirements:')).toHaveClass('font-semibold')
  expect(container.querySelector('b')).toBeNull()
  expect(screen.getByRole('listitem')).toHaveTextContent('Ruby')
})
