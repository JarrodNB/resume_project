/**
 * Description: Drop area around one list of sortable items, so an item can be dropped into the
 * list even when it is empty (e.g. moving a highlight into a role with none).
 * Index:
 *   - SortableGroup: droppable container that accepts one item type
 */
import type { ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/react'
import { cn } from '@/lib/utils'

/** Lower than the items' default priority, so hovering an item wins over hovering its list. */
const BELOW_ITEMS_COLLISION_PRIORITY = 1

interface SortableGroupProps {
  /** The `group` of the items inside (see `sortableGroupId`). */
  id: string
  accept: string
  className?: string
  children: ReactNode
}

/** Renders the list container; it is outlined while an item is dragged over it. */
export function SortableGroup({ id, accept, className, children }: SortableGroupProps) {
  const { ref, isDropTarget } = useDroppable({
    id,
    type: `${accept}-group`,
    accept,
    collisionPriority: BELOW_ITEMS_COLLISION_PRIORITY,
  })

  return (
    <div ref={ref} className={cn('rounded-md transition-colors', isDropTarget && 'bg-primary/5 ring-1 ring-primary/40', className)}>
      {children}
    </div>
  )
}
