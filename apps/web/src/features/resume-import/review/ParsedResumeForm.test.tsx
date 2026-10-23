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
  expected.experiences[0].roles[0] = { ...expected.experiences[0].roles[0], title: 'Senior Engineer', highlights: ['Built the billing service'] }
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

it('edits shared and role bullets without merging separate same-company blocks', async () => {
  const user = userEvent.setup()
  const parsed = buildParsedResume()
  parsed.experiences = [
    { company: 'Acme', location: null, description: null, roles: [
      { title: 'Lead', start_date: '2024', end_date: null, is_current: true, description: null, highlights: ['Lead bullet'] },
      { title: 'Engineer', start_date: '2020', end_date: '2023', is_current: false, description: null, highlights: [] },
    ], shared_highlights: ['Shared bullet', 'Remove shared'] },
    { company: 'Acme', location: null, description: null, roles: [
      { title: 'Consultant', start_date: '2018', end_date: '2019', is_current: false, description: null, highlights: ['Separate bullet'] },
    ], shared_highlights: [] },
  ]
  const onImport = vi.fn()
  render(<ParsedResumeForm parsedResume={parsed} onImport={onImport} importing={false} errors={[]} />)
  expect(screen.getByDisplayValue('Lead')).toBeInTheDocument()
  await user.type(screen.getAllByLabelText('Shared highlights 1')[0], ' edited')
  await user.click(screen.getByRole('button', { name: 'Remove Shared highlights 2' }))
  await user.type(screen.getAllByLabelText('Highlights 1')[0], ' edited')
  await user.click(screen.getByRole('button', { name: 'Save to career library' }))
  parsed.experiences[0].shared_highlights = ['Shared bullet edited']
  parsed.experiences[0].roles[0].highlights = ['Lead bullet edited']
  expect(onImport).toHaveBeenCalledWith(parsed)
})

it('requires moving or removing role highlights before removing the role', async () => {
  const user = userEvent.setup()
  const parsed = buildParsedResume()
  parsed.experiences[0].roles.push({ title: 'Earlier role', start_date: null, end_date: null, is_current: false, description: null, highlights: [] })
  render(<ParsedResumeForm parsedResume={parsed} onImport={vi.fn()} importing={false} errors={[]} />)
  const removeRole = screen.getByRole('button', { name: 'Remove role 1' })
  expect(removeRole).toBeDisabled()
  expect(screen.getByText('Move or remove this role’s highlights before removing the role.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Remove Highlights 1' }))
  await user.click(screen.getByRole('button', { name: 'Remove Highlights 1' }))
  expect(removeRole).toBeEnabled()
  await user.click(removeRole)
  expect(screen.queryByDisplayValue('Engineer')).not.toBeInTheDocument()
  expect(screen.getByDisplayValue('Earlier role')).toBeInTheDocument()
})
