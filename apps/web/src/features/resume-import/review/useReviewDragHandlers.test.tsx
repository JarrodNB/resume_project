/** Exercise scoped highlight moves and cancellation through the review draft.
 * Shared lists and role lists remain distinct even when company names match.
 */
import { useState } from 'react'
import { act, renderHook } from '@testing-library/react'
import type { DragDropEventHandlers } from '@dnd-kit/react'
import { expect, it } from 'vitest'
import { buildParsedResume } from '@/test/parsedResumeFixture'
import { toParsedResume, toReviewDraft, withDraftKey } from './reviewDraft'
import { highlightGroups, moveHighlight, useReviewDragHandlers } from './useReviewDragHandlers'

it('moves a role bullet into another block shared list without duplicating it', () => {
  const parsed = buildParsedResume()
  parsed.experiences.push({ ...parsed.experiences[0], roles: [{ ...parsed.experiences[0].roles[0], highlights: [] }], shared_highlights: ['Already shared'] })
  const draft = toReviewDraft(parsed)
  const from = `highlights-of:${draft.experiences[0].roles[0].key}`
  const to = `highlights-of:${draft.experiences[1].key}`
  const moved = toParsedResume({ ...draft, experiences: moveHighlight(draft.experiences, { from: { group: from, index: 1 }, to: { group: to, index: 0 } }) })
  expect(moved.experiences[0].roles[0].highlights).toEqual(['Built the billing service'])
  expect(moved.experiences[1].shared_highlights).toEqual(['Cut deploy time in half', 'Already shared'])
  expect(moved.experiences[1].roles[0].highlights).toEqual([])
  expect(Object.keys(highlightGroups(draft.experiences))).toHaveLength(4)
})

it('refuses a move into a full list while allowing reorder within it', () => {
  const draft = toReviewDraft(buildParsedResume())
  const entry = draft.experiences[0]
  entry.shared_highlights = Array.from({ length: 40 }, (_, index) => withDraftKey({ text: `Bullet ${index}` }))
  const shared = `highlights-of:${entry.key}`
  const role = `highlights-of:${entry.roles[0].key}`
  expect(moveHighlight(draft.experiences, { from: { group: role, index: 0 }, to: { group: shared, index: 0 } })).toEqual(draft.experiences)
  const reordered = moveHighlight(draft.experiences, { from: { group: shared, index: 0 }, to: { group: shared, index: 39 } })
  expect(reordered[0].shared_highlights[39].text).toBe('Bullet 0')
})

it('restores original scopes after a canceled highlight drag', () => {
  const original = toReviewDraft(buildParsedResume())
  const { result } = renderHook(() => {
    const [draft, setDraft] = useState(original)
    return { draft, setDraft, handlers: useReviewDragHandlers(draft, setDraft) }
  })
  act(() => result.current.handlers.onDragStart?.({} as Parameters<NonNullable<DragDropEventHandlers['onDragStart']>>[0], {} as Parameters<NonNullable<DragDropEventHandlers['onDragStart']>>[1]))
  act(() => result.current.setDraft((draft) => ({ ...draft, experiences: moveHighlight(draft.experiences, {
    from: { group: `highlights-of:${draft.experiences[0].roles[0].key}`, index: 0 },
    to: { group: `highlights-of:${draft.experiences[0].key}`, index: 0 },
  }) })))
  expect(result.current.draft.experiences[0].shared_highlights).toHaveLength(1)
  act(() => result.current.handlers.onDragEnd?.({ canceled: true, operation: { source: { type: 'highlight' } } } as Parameters<NonNullable<DragDropEventHandlers['onDragEnd']>>[0], {} as Parameters<NonNullable<DragDropEventHandlers['onDragEnd']>>[1]))
  expect(toParsedResume(result.current.draft)).toEqual(toParsedResume(original))
})
