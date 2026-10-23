/** Checks explicit grouping and stable nested bullet edits without a browser. */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { ExperienceFormDialog } from './ExperienceFormDialog'

const save = vi.fn().mockResolvedValue(true)
vi.mock('./useSaveLibraryRecord', () => ({ useSaveLibraryRecord: () => ({save, busy: false, errors: []}) }))

it('adds multiple roles inside one experience and keeps shared bullets separate', async () => {
  const user = userEvent.setup()
  render(<ExperienceFormDialog open experience={null} onOpenChange={() => {}} />)
  const dialog = screen.getByRole('dialog', {name: 'Add experience'})
  await user.type(within(dialog).getByLabelText('Company'), 'Example')
  await user.type(within(dialog).getByLabelText('Title'), 'Lead')
  await user.click(within(dialog).getByRole('button', {name: 'Add role'}))
  const titles = within(dialog).getAllByLabelText('Title')
  await user.type(titles[1], 'Engineer')
  const shared = within(dialog).getByRole('group', {name: 'Shared highlights'})
  await user.click(within(shared).getByRole('button', {name: 'Add highlight'}))
  await user.type(within(shared).getByRole('textbox'), 'Shared evidence')
  await user.click(within(dialog).getByRole('button', {name: 'Save'}))
  expect(save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({attributes: expect.objectContaining({
    company: 'Example', roles: [expect.objectContaining({title: 'Lead'}), expect.objectContaining({title: 'Engineer'})],
    sharedHighlights: [{content: 'Shared evidence'}],
  })}))
})

it('moves an existing bullet to shared without changing its ID or role IDs', async () => {
  save.mockClear()
  const user = userEvent.setup()
  render(<ExperienceFormDialog open onOpenChange={() => {}} experience={{
    id: 'entry', company: 'Example', title: 'Lead', location: null, startDate: null, endDate: null, description: null,
    roles: [{id: 'lead', title: 'Lead', startDate: null, endDate: null, description: null, position: 0},
      {id: 'engineer', title: 'Engineer', startDate: null, endDate: null, description: null, position: 1}],
    highlights: [{id: 'bullet', content: 'Saved evidence', experienceRoleId: 'lead', position: 0}],
  }} />)
  const dialog = screen.getByRole('dialog', {name: 'Edit experience'})
  const lead = within(dialog).getByRole('group', {name: 'Lead highlights'})
  await user.selectOptions(within(lead).getByRole('combobox'), 'shared')
  expect(within(lead).queryByRole('textbox')).not.toBeInTheDocument()
  const shared = within(dialog).getByRole('group', {name: 'Shared highlights'})
  expect(within(shared).getByRole('textbox')).toHaveValue('Saved evidence')
  await user.click(within(dialog).getByRole('button', {name: 'Save'}))
  expect(save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({id: 'entry', attributes: expect.objectContaining({
    roles: [expect.objectContaining({id: 'lead', highlights: []}), expect.objectContaining({id: 'engineer', highlights: []})],
    sharedHighlights: [{id: 'bullet', content: 'Saved evidence'}],
  })}))
})

it('explicitly removes a bullet when removing its role before saving', async () => {
  save.mockClear()
  const user = userEvent.setup()
  render(<ExperienceFormDialog open onOpenChange={() => {}} experience={{
    id: 'entry', company: 'Example', title: 'Lead', location: null, startDate: null, endDate: null, description: null,
    roles: [{id: 'lead', title: 'Lead', startDate: null, endDate: null, description: null, position: 0},
      {id: 'engineer', title: 'Engineer', startDate: null, endDate: null, description: null, position: 1}],
    highlights: [{id: 'bullet', content: 'Remove evidence', experienceRoleId: 'lead', position: 0}],
  }} />)
  const dialog = screen.getByRole('dialog', {name: 'Edit experience'})
  const removeRole = within(dialog).getAllByRole('button', {name: 'Remove role'})[0]
  expect(removeRole).toBeDisabled()
  await user.click(within(dialog).getByRole('button', {name: 'Remove highlight'}))
  await user.click(removeRole)
  await user.click(within(dialog).getByRole('button', {name: 'Save'}))
  expect(save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({attributes: expect.objectContaining({
    roles: [expect.objectContaining({id: 'engineer'})], removedHighlightIds: ['bullet'],
  })}))
})
