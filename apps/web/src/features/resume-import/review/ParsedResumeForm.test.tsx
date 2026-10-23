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

it('requires assignment or explicit discard and supports undo', async () => {
  const user = userEvent.setup()
  const onImport = vi.fn()
  const parsed = { ...buildParsedResume(), unassigned_highlights: [{ source_id: 'bullet-7', text: 'Shared achievement', source_context: 'Acme roles' }] }
  const { container } = render(<ParsedResumeForm parsedResume={parsed} onImport={onImport} importing={false} errors={[]} />)
  const save = screen.getByRole('button', { name: 'Save to career library' })
  expect(save).toBeDisabled()
  container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  expect(onImport).not.toHaveBeenCalled()
  expect(screen.getByText('Acme roles')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Discard bullet 1' }))
  expect(save).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Undo discard bullet 1' }))
  expect(save).toBeDisabled()
  await user.selectOptions(screen.getByLabelText('Destination for bullet 1'), screen.getByRole('option', { name: /Engineer at Acme/ }))
  await user.click(screen.getByRole('button', { name: 'Assign bullet 1' }))
  await user.click(save)
  expect(onImport.mock.calls[0][0].unassigned_highlights).toEqual([])
  expect(onImport.mock.calls[0][0].experiences[0].highlights).toContain('Shared achievement')
})

it('assigns a source bullet to an experience added during review', async () => {
  const user = userEvent.setup()
  const onImport = vi.fn()
  const parsed = { ...buildParsedResume(), unassigned_highlights: [{ source_id: 'b8', text: 'Built a prototype', source_context: 'Independent work' }] }
  render(<ParsedResumeForm parsedResume={parsed} onImport={onImport} importing={false} errors={[]} />)
  await user.click(screen.getByRole('button', { name: 'Add experience' }))
  await user.type(screen.getAllByLabelText(/^Company/)[1], 'New Co')
  await user.type(screen.getAllByLabelText(/^Title/)[1], 'Builder')
  await user.selectOptions(screen.getByLabelText('Destination for bullet 1'), screen.getByRole('option', { name: /Builder at New Co/ }))
  await user.click(screen.getByRole('button', { name: 'Assign bullet 1' }))
  await user.click(screen.getByRole('button', { name: 'Save to career library' }))
  expect(onImport.mock.calls[0][0].experiences[1]).toMatchObject({ title: 'Builder', company: 'New Co', highlights: ['Built a prototype'] })
})
