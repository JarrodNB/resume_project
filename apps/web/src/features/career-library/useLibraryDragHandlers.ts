/**
 * Description: Drag-and-drop handlers for the career library page. Roles, projects, and education
 * are always listed by date, so only highlights and skills move: highlights follow the pointer
 * between roles while dragging and are saved on drop (or put back if the drag is canceled);
 * skills reorder within their category and are saved on drop.
 * Index:
 *   - HIGHLIGHT_TYPE, skillDragType: drag types used by the page's sortables
 *   - useLibraryDragHandlers: DragDropProvider handlers plus `highlightsOf(experienceId)`
 */
import { useRef, useState } from 'react'
import type { DragDropEventHandlers, DragEndEvent } from '@dnd-kit/react'
import {
  findItemLocation,
  idFromSortableId,
  moveBetweenGroups,
  projectedMove,
  reorderList,
  sortableGroupId,
  sortableId,
  type ItemLocation,
} from '@/components/dnd/moveItems'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { groupSkillsByCategory } from './groupSkillsByCategory'
import type { useLibraryReordering } from './useLibraryReordering'

export const HIGHLIGHT_TYPE = 'highlight'
const SKILL_TYPE_PREFIX = 'skill-in:'

/** Drag type of a skill (skills only land within their own category). */
export function skillDragType(category: string) {
  return `${SKILL_TYPE_PREFIX}${category}`
}

type Highlight = CareerLibraryQuery['experiences'][number]['highlights'][number]
type Reordering = ReturnType<typeof useLibraryReordering>

/** Highlight sortable ids for each role, keyed by the role's group id. */
function highlightGroups(experiences: CareerLibraryQuery['experiences']): Record<string, string[]> {
  return Object.fromEntries(
    experiences.flatMap((experience) => experience.roles?.length ? [null, ...experience.roles.map((role) => role.id)].map((roleId) => [
      sortableGroupId('highlights', `${experience.id}/${roleId ?? 'shared'}`),
      experience.highlights.filter((bullet) => bullet.experienceRoleId === roleId).map((bullet) => sortableId(HIGHLIGHT_TYPE, bullet.id)),
    ]) : [[sortableGroupId('highlights', experience.id), experience.highlights.map((bullet) => sortableId(HIGHLIGHT_TYPE, bullet.id))]]),
  )
}

/** Converts a highlight location (group id + index) into a role id + index. */
function toPlacement(location: ItemLocation) {
  const [experienceId, scope] = idFromSortableId(location.group).split('/')
  return { experienceId, ...(scope ? {experienceRoleId: scope === 'shared' ? null : scope} : {}), index: location.index }
}

/** Every skill id in display order, with one category's skills reordered after a drop. */
function skillOrderAfterDrop(skills: CareerLibraryQuery['skills'], category: string, event: DragEndEvent): string[] | null {
  const groups = groupSkillsByCategory(skills)
  const categoryIds = groups.find(([name]) => name === category)?.[1].map((skill) => sortableId('skill', skill.id)) ?? []
  const skillMove = projectedMove({ list: categoryIds }, event)
  if (!skillMove) return null
  return groups.flatMap(([name, categorySkills]) => {
    const ids = categorySkills.map((skill) => skill.id)
    return name === category ? reorderList(ids, skillMove.from.index, skillMove.to.index) : ids
  })
}

/** Returns the page's drag handlers, saving each finished drag through `reordering`. */
export function useLibraryDragHandlers(library: CareerLibraryQuery | null | undefined, reordering: Reordering) {
  const [draggedHighlightGroups, setDraggedHighlightGroups] = useState<Record<string, string[]> | null>(null)
  const highlightStart = useRef<ItemLocation | null>(null)
  const highlightsById = new Map<string, Highlight>(
    library?.experiences.flatMap((experience) => experience.highlights.map((highlight) => [highlight.id, highlight])) ?? [],
  )

  /** Highlights of a role as currently shown (follows an in-progress drag). */
  function highlightsOf(experienceId: string, roleId?: string | null): Highlight[] {
    const groupKey = roleId === undefined ? experienceId : `${experienceId}/${roleId ?? "shared"}`
    const draggedIds = draggedHighlightGroups?.[sortableGroupId('highlights', groupKey)]
    if (!draggedIds) return (library?.experiences.find((experience) => experience.id === experienceId)?.highlights ?? []).filter((bullet) => roleId === undefined || bullet.experienceRoleId === roleId)
    return draggedIds.map((id) => highlightsById.get(idFromSortableId(id))).filter((highlight) => highlight !== undefined)
  }

  /** Saves a highlight drop if it ended somewhere new. */
  function finishHighlightDrag(event: DragEndEvent) {
    const start = highlightStart.current
    const draggedId = String(event.operation.source?.id ?? '')
    const end = draggedHighlightGroups && findItemLocation(draggedHighlightGroups, draggedId)
    if (!event.canceled && start && end && (start.group !== end.group || start.index !== end.index)) {
      void reordering.moveHighlight(idFromSortableId(draggedId), toPlacement(start), toPlacement(end))
    }
    highlightStart.current = null
    setDraggedHighlightGroups(null)
  }

  /** Saves a skill drop. */
  function finishSkillDrag(event: DragEndEvent, type: string) {
    if (!library || event.canceled) return
    const orderedIds = skillOrderAfterDrop(library.skills, type.slice(SKILL_TYPE_PREFIX.length), event)
    if (orderedIds) void reordering.reorderSkills(orderedIds)
  }

  const handlers: Pick<DragDropEventHandlers, 'onDragStart' | 'onDragOver' | 'onDragEnd'> = {
    onDragStart: (event) => {
      reordering.clearErrors()
      if (!library || event.operation.source?.type !== HIGHLIGHT_TYPE) return
      const groups = highlightGroups(library.experiences)
      highlightStart.current = findItemLocation(groups, String(event.operation.source.id))
      setDraggedHighlightGroups(groups)
    },
    onDragOver: (event) => {
      if (event.operation.source?.type !== HIGHLIGHT_TYPE || !draggedHighlightGroups) return
      const highlightMove = projectedMove(draggedHighlightGroups, event)
      if (highlightMove) setDraggedHighlightGroups(moveBetweenGroups(draggedHighlightGroups, highlightMove))
    },
    onDragEnd: (event) => {
      const type = String(event.operation.source?.type ?? '')
      if (type === HIGHLIGHT_TYPE) finishHighlightDrag(event)
      else if (type.startsWith(SKILL_TYPE_PREFIX)) finishSkillDrag(event, type)
    },
  }

  return { handlers, highlightsOf }
}
