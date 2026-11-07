/** Check ongoing controls and plain-language topics through the forms' save boundary. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { EducationFormDialog } from './EducationFormDialog'
import { ProjectFormDialog } from './ProjectFormDialog'
import { CareerContextFormDialog } from './CareerContextFormDialog'
import { CREATE_EDUCATION_MUTATION, UPDATE_EDUCATION_MUTATION, CREATE_PROJECT_MUTATION, UPDATE_PROJECT_MUTATION } from './careerLibrarySaveMutations'

const { save } = vi.hoisted(() => ({ save: vi.fn(async () => true) }))
vi.mock('./useSaveLibraryRecord', () => ({ useSaveLibraryRecord: () => ({ save, busy: false, errors: [] }) }))
beforeEach(() => save.mockClear())

const education = { id: 'edu-1', institution: 'State', degree: null, fieldOfStudy: null, description: null, startDate: null, endDate: null, ongoing: false }
const project = { id: 'project-1', name: 'Research', role: null, url: null, description: null, startDate: null, endDate: null, ongoing: false }
for (const kind of ['education', 'project'] as const) {
  const label = kind === 'education' ? 'Currently studying' : 'Ongoing'
  const field = kind === 'education' ? 'Institution' : 'Name'
  const attributes = kind === 'education'
    ? { institution: 'State', degree: null, fieldOfStudy: null, startDate: null, description: null }
    : { name: 'Research', role: null, url: null, startDate: null, description: null }
  function show(mode: 'new' | 'ongoing' | 'finished' | 'unknown') {
    const overrides = { ongoing: mode === 'ongoing', endDate: mode === 'finished' ? '2025-01-01' : null }
    return render(kind === 'education'
      ? <EducationFormDialog open onOpenChange={() => {}} education={mode === 'new' ? null : { ...education, ...overrides }} />
      : <ProjectFormDialog open onOpenChange={() => {}} project={mode === 'new' ? null : { ...project, ...overrides }} />)
  }
  it(`${kind}: creates ongoing with a cleared disabled end date`, async () => {
    show('new')
    fireEvent.change(screen.getByLabelText(field), { target: { value: kind === 'education' ? 'State' : 'Research' } })
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2025-01-01' } })
    await userEvent.click(screen.getByRole('checkbox', { name: label }))
    expect(screen.getByLabelText('End')).toBeDisabled()
    expect(screen.getByLabelText('End')).toHaveValue('')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(kind === 'education' ? CREATE_EDUCATION_MUTATION : CREATE_PROJECT_MUTATION,
      { attributes: { ...attributes, endDate: null, ongoing: true } }))
  })
  it(`${kind}: restores ongoing on edit and can save a finish date`, async () => {
    show('ongoing')
    expect(screen.getByRole('checkbox', { name: label })).toBeChecked()
    expect(screen.getByLabelText('End')).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: label }))
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2026-04-01' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(save).toHaveBeenCalledWith(kind === 'education' ? UPDATE_EDUCATION_MUTATION : UPDATE_PROJECT_MUTATION,
      { id: kind === 'education' ? education.id : project.id, attributes: { ...attributes, endDate: '2026-04-01', ongoing: false } })
  })
  it(`${kind}: selecting and clearing ongoing never restores a discarded end date`, async () => {
    show('finished')
    expect(screen.getByLabelText('End')).toHaveValue('2025-01-01')
    await userEvent.click(screen.getByRole('checkbox', { name: label }))
    await userEvent.click(screen.getByRole('checkbox', { name: label }))
    expect(screen.getByLabelText('End')).toBeEnabled()
    expect(screen.getByLabelText('End')).toHaveValue('')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ attributes: { ...attributes, endDate: null, ongoing: false } }))
  })
  it(`${kind}: does not infer ongoing from an unknown end date`, () => {
    show('unknown')
    expect(screen.getByRole('checkbox', { name: label })).not.toBeChecked()
    expect(screen.getByLabelText('End')).toBeEnabled()
  })
}

it('uses a plain-language topic label and validation for a manually added note', async () => {
  render(<CareerContextFormDialog open onOpenChange={() => {}} context={null} />)
  expect(screen.getByLabelText('Topic or question')).toHaveValue('')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(screen.getByText('Topic or question is required.')).toBeInTheDocument()
  expect(screen.getByLabelText('Topic or question')).toHaveAttribute('aria-invalid', 'true')
  expect(save).not.toHaveBeenCalled()
})
it('uses the same editable topic label for saved gap context', () => {
  render(<CareerContextFormDialog open onOpenChange={() => {}} context={{ id: 'note-1', requirement: 'Present to senior leaders', response: 'Presented churn reports to the VP.' }} />)
  expect(screen.getByLabelText('Topic or question')).toHaveValue('Present to senior leaders')
})
