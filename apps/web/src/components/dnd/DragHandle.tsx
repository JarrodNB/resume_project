/**
 * Description: Grip button that starts a drag. Works with the pointer and the keyboard (focus,
 * Space to pick up, arrows to move, Space to drop, Escape to cancel).
 * Index:
 *   - DragHandle: icon button connected to a sortable's `handleRef`
 */
import type { Ref } from 'react'
import { GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DragHandleProps {
  handleRef: Ref<HTMLButtonElement>
  /** What is being dragged, for screen readers (e.g. "Engineer at Acme"). */
  label: string
  className?: string
}

/** Renders the grip icon button used to drag an item. */
export function DragHandle({ handleRef, label, className }: DragHandleProps) {
  return (
    <button
      ref={handleRef}
      type="button"
      aria-label={`Drag ${label}`}
      className={cn(
        'flex shrink-0 cursor-grab touch-none items-center justify-center rounded-md p-1 text-muted-foreground',
        'hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing',
        className,
      )}
    >
      <GripVertical className="size-4" aria-hidden />
    </button>
  )
}
