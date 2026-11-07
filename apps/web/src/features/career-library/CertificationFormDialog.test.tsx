/** Certification dates reject invalid input locally and preserve the precision the user chooses. */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { CertificationFormDialog } from './CertificationFormDialog'
import { CREATE_CERTIFICATION_MUTATION } from './careerLibrarySaveMutations'

it('shows a field error for malformed dates without sending a mutation or losing the form', async () => {
  const user = userEvent.setup()
  renderPage({ path: '/library', url: '/library', element: <CertificationFormDialog open certification={null} onOpenChange={vi.fn()} /> })
  await user.type(screen.getByLabelText('Certification name'), 'Cloud Architect')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Precision for Issued' }), 'year')
  const issued = screen.getByLabelText('Issued (YYYY)')
  fireEvent.change(issued, { target: { value: 'last year' } })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(issued).toHaveAccessibleDescription(/Enter a year \(2024\)/)
  expect(issued).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByLabelText('Certification name')).toHaveValue('Cloud Architect')
  expect(screen.queryByText(/Could not reach/)).not.toBeInTheDocument()
})

it('provides native date and month selection and submits partial dates with their precision', async () => {
  const user = userEvent.setup()
  const close = vi.fn()
  renderPage({
    path: '/library', url: '/library',
    element: <CertificationFormDialog open certification={null} onOpenChange={close} />,
    mocks: [{
      request: { query: CREATE_CERTIFICATION_MUTATION, variables: { attributes: {
        name: 'Cloud Architect', issuer: null, issuedDate: '2024-06-01', issuedDatePrecision: 'month',
        expiryDate: '2027-01-01', expiryDatePrecision: 'year', credentialId: null, credentialUrl: null, description: null,
      } } },
      result: { data: { createCertification: { __typename: 'CreateCertificationPayload', errors: [] } } },
    }],
  })
  await user.type(screen.getByLabelText('Certification name'), 'Cloud Architect')
  expect(screen.getByLabelText('Issued (YYYY-MM-DD)')).toHaveAttribute('type', 'date')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Precision for Issued' }), 'month')
  const issued = screen.getByLabelText('Issued (YYYY-MM)')
  expect(issued).toHaveAttribute('type', 'month')
  fireEvent.change(issued, { target: { value: '2024-06' } })
  await user.selectOptions(screen.getByRole('combobox', { name: 'Precision for Expires' }), 'year')
  await user.type(screen.getByLabelText('Expires (YYYY)'), '2027')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(close).toHaveBeenCalledWith(false))
})

it('clears a partial date when the user requests more precision instead of inventing the missing month or day', async () => {
  const user = userEvent.setup()
  renderPage({ path: '/library', url: '/library', element: <CertificationFormDialog open certification={null} onOpenChange={vi.fn()} /> })
  await user.selectOptions(screen.getByRole('combobox', { name: 'Precision for Issued' }), 'year')
  await user.type(screen.getByLabelText('Issued (YYYY)'), '2024')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Precision for Issued' }), 'day')
  expect(screen.getByLabelText('Issued (YYYY-MM-DD)')).toHaveValue('')
})

it('blocks an incomplete native date without treating it as an intentional clear', async () => {
  const user = userEvent.setup()
  renderPage({ path: '/library', url: '/library', element: <CertificationFormDialog open certification={null} onOpenChange={vi.fn()} /> })
  await user.type(screen.getByLabelText('Certification name'), 'Cloud Architect')
  const issued = screen.getByLabelText('Issued (YYYY-MM-DD)')
  // jsdom does not model native date editing; Chrome exposes an incomplete date this way.
  Object.defineProperty(issued, 'validity', { configurable: true, value: { badInput: true } })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(issued).toHaveAccessibleDescription(/Complete the issued date or clear it/)
})
