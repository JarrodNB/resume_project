/** Keep review highlights in their role or shared company lists while dragging.
 * List membership changes only in the draft, full targets refuse extra bullets, and
 * cancel restores the original scopes. Skills reorder when dropped.
 */
import { useRef, type Dispatch, type SetStateAction } from 'react'
import type { DragDropEventHandlers } from '@dnd-kit/react'
import { moveBetweenGroups, projectedMove, reorderList, sortableGroupId, sortableId, type ItemMove } from '@/components/dnd/moveItems'
import type { DraftExperience, ReviewDraft } from './reviewDraft'

export const HIGHLIGHT_TYPE = 'highlight'
export const SKILL_TYPE = 'skill'

/** Shared and role lists have independent stable drag groups, including empty lists. */
function highlightLists(experiences: DraftExperience[]) {
  return experiences.flatMap((experience) => [
    { key: experience.key, highlights: experience.shared_highlights },
    ...experience.roles.map((role) => ({ key: role.key, highlights: role.highlights })),
  ])
}

/** Highlight sortable ids keyed by the actual list that owns each bullet. */
export function highlightGroups(experiences: DraftExperience[]): Record<string, string[]> {
  return Object.fromEntries(highlightLists(experiences).map((list) => [
    sortableGroupId('highlights', list.key),
    list.highlights.map((highlight) => sortableId(HIGHLIGHT_TYPE, highlight.key)),
  ]))
}

/** Moves a bullet to its selected scope, respecting each list's forty-bullet bound. */
export function moveHighlight(experiences: DraftExperience[], highlightMove: ItemMove): DraftExperience[] {
  const byGroup = Object.fromEntries(highlightLists(experiences).map((list) => [sortableGroupId('highlights', list.key), list.highlights]))
  const { from, to } = highlightMove
  if (!byGroup[from.group]?.[from.index] || !byGroup[to.group] || (from.group !== to.group && byGroup[to.group].length >= 40)) return experiences
  const moved = moveBetweenGroups(byGroup, highlightMove)
  return experiences.map((experience) => ({
    ...experience,
    shared_highlights: moved[sortableGroupId('highlights', experience.key)],
    roles: experience.roles.map((role) => ({ ...role, highlights: moved[sortableGroupId('highlights', role.key)] })),
  }))
}

/** Returns the DragDropProvider handlers that keep `draft` in step with what the user drags. */
export function useReviewDragHandlers(
  draft: ReviewDraft,
  setDraft: Dispatch<SetStateAction<ReviewDraft>>,
): Pick<DragDropEventHandlers, 'onDragStart' | 'onDragOver' | 'onDragEnd'> {
  const experiencesBeforeDrag = useRef<DraftExperience[] | null>(null)

  return {
    onDragStart: () => {
      experiencesBeforeDrag.current = draft.experiences
    },
    onDragOver: (event) => {
      if (event.operation.source?.type !== HIGHLIGHT_TYPE) return
      const highlightMove = projectedMove(highlightGroups(draft.experiences), event)
      if (highlightMove) setDraft({ ...draft, experiences: moveHighlight(draft.experiences, highlightMove) })
    },
    onDragEnd: (event) => {
      const type = event.operation.source?.type
      const before = experiencesBeforeDrag.current
      experiencesBeforeDrag.current = null
      if (type === HIGHLIGHT_TYPE) {
        if (event.canceled && before) setDraft({ ...draft, experiences: before })
        return
      }
      if (type !== SKILL_TYPE || event.canceled) return
      const skillMove = projectedMove({ list: draft.skills.map((skill) => sortableId(SKILL_TYPE, skill.key)) }, event)
      if (skillMove) setDraft({ ...draft, skills: reorderList(draft.skills, skillMove.from.index, skillMove.to.index) })
    },
  }
}
