/**
 * Description: One draggable, reorderable item. Only its drag handle starts a drag, so inputs
 * inside the item keep working normally.
 * Index:
 *   - SortableItem: wraps useSortable; passes the drag handle to `children` to place
 */
import type { ReactNode } from 'react'
import { useSortable } from '@dnd-kit/react/sortable'
import { cn } from '@/lib/utils'
import { DragHandle } from './DragHandle'

interface SortableItemProps {
  /** Unique across the whole drag-and-drop area (see `sortableId`). */
  id: string
  index: number
  /** Items only land among items of the same type (e.g. "highlight", "entry:experience"). */
  type: string
  /** The list the item is in, when items can move between lists. */
  group?: string
  /** Describes the item for the drag handle's label. */
  label: string
  className?: string
  children: (dragHandle: ReactNode) => ReactNode
}

/** Renders a sortable item; it fades while being dragged. */
export function SortableItem({ id, index, type, group, label, className, children }: SortableItemProps) {
  const { ref, handleRef, isDragging } = useSortable({ id, index, type, accept: type, group })

  return (
    <div ref={ref} className={cn('transition-opacity', isDragging && 'opacity-60', className)} data-dragging={isDragging || undefined}>
      {children(<DragHandle handleRef={handleRef} label={label} />)}
    </div>
  )
}
