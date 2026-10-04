/**
 * Description: Pure helpers for drag-and-drop: unique sortable ids, locating items in grouped
 * lists, and applying a move (within a list or from one list to another).
 * Index:
 *   - ItemLocation, ItemMove: where an item is / where it moved
 *   - sortableId, sortableGroupId, idFromSortableId: ids that stay unique across item kinds
 *   - reorderList: moves one item within a list
 *   - moveBetweenGroups: moves one item between (or within) lists keyed by group
 *   - findItemLocation: group and index of an item
 *   - projectedMove: where dnd-kit says the dragged item now belongs, or null if it didn't move
 */
import { move } from '@dnd-kit/helpers'
import type { DragEndEvent, DragOverEvent } from '@dnd-kit/react'

export interface ItemLocation {
  group: string
  index: number
}

export interface ItemMove {
  from: ItemLocation
  to: ItemLocation
}

/** Id for a sortable item, unique even when two kinds share database ids (e.g. "skill:4"). */
export function sortableId(kind: string, id: string) {
  return `${kind}:${id}`
}

/** Id for the list holding sortable items (e.g. "highlights-of:12"). */
export function sortableGroupId(kind: string, ownerId: string) {
  return `${kind}-of:${ownerId}`
}

/** The original id inside a sortable or group id. */
export function idFromSortableId(id: string) {
  return id.slice(id.indexOf(':') + 1)
}

/** Returns a copy of `items` with the item at `fromIndex` moved to `toIndex`. */
export function reorderList<Item>(items: Item[], fromIndex: number, toIndex: number): Item[] {
  const reordered = items.slice()
  const [moved] = reordered.splice(fromIndex, 1)
  reordered.splice(toIndex, 0, moved)
  return reordered
}

/** Returns a copy of `groups` with one item moved; other groups keep their arrays. */
export function moveBetweenGroups<Item>(groups: Record<string, Item[]>, { from, to }: ItemMove): Record<string, Item[]> {
  if (from.group === to.group) return { ...groups, [from.group]: reorderList(groups[from.group], from.index, to.index) }

  const moved = groups[from.group][from.index]
  const target = groups[to.group].slice()
  target.splice(to.index, 0, moved)
  return {
    ...groups,
    [from.group]: groups[from.group].filter((_, index) => index !== from.index),
    [to.group]: target,
  }
}

/** Finds which group holds `itemId` and at what index. */
export function findItemLocation(groups: Record<string, string[]>, itemId: string): ItemLocation | null {
  for (const [group, itemIds] of Object.entries(groups)) {
    const index = itemIds.indexOf(itemId)
    if (index !== -1) return { group, index }
  }
  return null
}

/** Asks dnd-kit where the dragged item belongs now; null when its place hasn't changed. */
export function projectedMove(groups: Record<string, string[]>, event: DragOverEvent | DragEndEvent): ItemMove | null {
  const draggedId = event.operation.source?.id
  if (draggedId == null) return null

  const from = findItemLocation(groups, String(draggedId))
  const to = findItemLocation(move(groups, event), String(draggedId))
  if (!from || !to || (from.group === to.group && from.index === to.index)) return null
  return { from, to }
}
