/** Verify that placement choices follow stable roles across edits and additions. */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { emptyExperience } from '../parsedResume'
import { UnassignedHighlights } from './UnassignedHighlights'
import { withDraftKey } from './reviewDraft'

it('keeps same-title destinations distinct after reorder and accepts newly added roles', async () => {
  const user = userEvent.setup()
  const first = withDraftKey({ ...emptyExperience(), title: 'Engineer', company: 'Acme', start_date: '2020', highlights: [] })
  const second = withDraftKey({ ...first, start_date: '2022' })
  const item = { source_id: 'b7', text: 'Shared work', source_context: 'Acme roles' }
  const onAssign = vi.fn()
  const props = { highlights: [item], experiences: [first, second], discarded: [], onDiscard: vi.fn(), onUndo: vi.fn(), onAssign }
  const { rerender } = render(<UnassignedHighlights {...props} />)
  await user.selectOptions(screen.getByLabelText('Destination for bullet 1'), second.key)
  rerender(<UnassignedHighlights {...props} experiences={[second, first]} />)
  await user.click(screen.getByRole('button', { name: 'Assign bullet 1' }))
  expect(onAssign).toHaveBeenLastCalledWith(item, second.key)
  const added = withDraftKey({ ...emptyExperience(), highlights: [] })
  rerender(<UnassignedHighlights {...props} experiences={[first, second, added]} />)
  await user.selectOptions(screen.getByLabelText('Destination for bullet 1'), added.key)
  await user.click(screen.getByRole('button', { name: 'Assign bullet 1' }))
  expect(onAssign).toHaveBeenLastCalledWith(item, added.key)
  rerender(<UnassignedHighlights {...props} experiences={[first, second]} />)
  expect(screen.getByRole('button', { name: 'Assign bullet 1' })).toBeDisabled()
})
