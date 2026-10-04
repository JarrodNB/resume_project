/**
 * Description: Drag-and-drop handlers for the review form. Roles, projects, and education aren't
 * dragged (the library lists them by date). Skills are reordered when dropped; highlights follow
 * the pointer between roles while dragging and are put back if the drag is canceled.
 * Index:
 *   - HIGHLIGHT_TYPE, SKILL_TYPE: drag types used by the form's sortables
 *   - highlightGroups: highlight sortable ids grouped by role
 *   - useReviewDragHandlers: onDragStart / onDragOver / onDragEnd for the DragDropProvider
 */
import { useRef, type Dispatch, type SetStateAction } from 'react'
import type { DragDropEventHandlers } from '@dnd-kit/react'
import { moveBetweenGroups, projectedMove, reorderList, sortableGroupId, sortableId, type ItemMove } from '@/components/dnd/moveItems'
import type { DraftExperience, ReviewDraft } from './reviewDraft'

export const HIGHLIGHT_TYPE = 'highlight'
export const SKILL_TYPE = 'skill'

/** Highlight sortable ids for each role, keyed by the role's group id. */
export function highlightGroups(experiences: DraftExperience[]): Record<string, string[]> {
  return Object.fromEntries(
    experiences.map((experience) => [
      sortableGroupId('highlights', experience.key),
      experience.highlights.map((highlight) => sortableId(HIGHLIGHT_TYPE, highlight.key)),
    ]),
  )
}

/** Applies a highlight move (group ids are role group ids) to the roles. */
function moveHighlight(experiences: DraftExperience[], highlightMove: ItemMove): DraftExperience[] {
  const byGroup = Object.fromEntries(
    experiences.map((experience) => [sortableGroupId('highlights', experience.key), experience.highlights]),
  )
  const moved = moveBetweenGroups(byGroup, highlightMove)
  return experiences.map((experience) => ({ ...experience, highlights: moved[sortableGroupId('highlights', experience.key)] }))
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
