/**
 * Description: Header button that opens or closes a section. The button's text is its accessible name.
 * Index:
 *   - CollapseToggle: chevron button with aria-expanded
 */
import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CollapseToggleProps {
  open: boolean
  panelId: string
  onToggle: () => void
  className?: string
  children: ReactNode
}

/** Renders the section header as a toggle. The chevron points down while the section is open. */
export function CollapseToggle({ open, panelId, onToggle, className, children }: CollapseToggleProps) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full cursor-pointer items-center gap-2 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        className,
      )}
      aria-expanded={open}
      aria-controls={panelId}
      onClick={onToggle}
    >
      <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden />
      {children}
    </button>
  )
}
