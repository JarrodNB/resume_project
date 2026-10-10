/**
 * Description: The review form shows warnings and submits the user's edits, not the original parse.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { buildParsedResume } from '@/test/parsedResumeFixture'
import { ParsedResumeForm } from './ParsedResumeForm'

function renderForm() {
  const onImport = vi.fn()
  render(<ParsedResumeForm parsedResume={buildParsedResume()} onImport={onImport} importing={false} errors={[]} />)
  return onImport
}

it('shows parsing warnings prominently', () => {
  renderForm()
  expect(screen.getByText('Please double-check these')).toBeInTheDocument()
  expect(screen.getByText('Unclear whether "Freelance" is a job or a project.')).toBeInTheDocument()
})

it('imports the edited resume', async () => {
  const user = userEvent.setup()
  const onImport = renderForm()

  const title = screen.getByLabelText(/^Title/)
  await user.clear(title)
  await user.type(title, 'Senior Engineer')
  await user.click(screen.getByRole('button', { name: 'Remove Highlights 2' }))
  await user.type(screen.getByLabelText('New skill'), 'Python{Enter}')
  await user.click(screen.getByRole('button', { name: 'Remove education 1' }))
  await user.click(screen.getByRole('button', { name: 'Save to career library' }))

  const expected = buildParsedResume()
  expected.experiences[0] = { ...expected.experiences[0], title: 'Senior Engineer', highlights: ['Built the billing service'] }
  expected.skills.push({ name: 'Python', category: null })
  expected.educations = []
  expect(onImport).toHaveBeenCalledWith(expected)
})

it('lists import errors', () => {
  render(
    <ParsedResumeForm
      parsedResume={buildParsedResume()}
      onImport={vi.fn()}
      importing={false}
      errors={['This resume has already been imported']}
    />,
  )
  expect(screen.getByText('This resume has already been imported')).toBeInTheDocument()
})

it('adds a certification to import without moving education records', async () => {
  const user = userEvent.setup()
  const onImport = renderForm()
  await user.click(screen.getByRole('button', { name: 'Add certification' }))
  await user.type(screen.getByLabelText(/^Certification name/), 'Cloud Architect')
  await user.type(screen.getByLabelText('Issuer'), 'Cloud Co')
  await user.type(screen.getByLabelText('Credential ID'), 'ABC')
  await user.click(screen.getByRole('button', { name: 'Save to career library' }))
  expect(onImport).toHaveBeenCalledWith(expect.objectContaining({
    educations: buildParsedResume().educations,
    certifications: [{ name: 'Cloud Architect', issuer: 'Cloud Co', issued_date: null, expiry_date: null, credential_id: 'ABC', credential_url: null, description: null }],
  }))
})
