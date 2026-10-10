/**
 * Description: An approved experience opens as a role with bullets, not one block of text.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { SectionPreview } from './SectionPreview'

it('shows a role, its dates, and each bullet', async () => {
  const user = userEvent.setup()
  render(
    <SectionPreview
      sectionId="preview.experience"
      section={{
        sectionType: 'experience',
        title: 'Experience',
        omitted: false,
        content: {
          items: [
            {
              title: 'Engineer',
              company: 'Acme',
              start_date: '2025-01',
              end_date: '2026-09',
              highlights: ['Built the assistant', 'Led the migration'],
            },
          ],
        },
      }}
    />,
  )

  await user.click(screen.getByRole('button', { name: 'Experience' }))

  expect(screen.getByRole('heading', { name: 'Engineer' })).toBeInTheDocument()
  expect(screen.getByText('Acme')).toBeInTheDocument()
  expect(screen.getByText('Jan 2025 – Sep 2026')).toBeInTheDocument()
  expect(screen.getByText('Built the assistant')).toBeInTheDocument()
  expect(screen.getByText('Led the migration')).toBeInTheDocument()
})

it('renders exact certification expiry dates in preview', async () => {
  const user = userEvent.setup()
  render(<SectionPreview sectionId="preview.certifications" section={{
    sectionType: 'certifications', title: 'Certifications', omitted: false,
    content: { items: [{ name: 'Cloud Architect', issued_date: '2024', expiry_date: '2026-10-31' }] },
  }} />)
  await user.click(screen.getByRole('button', { name: 'Certifications' }))
  expect(screen.getByText('Issued 2024 · Expires Oct 31, 2026')).toBeInTheDocument()
})
