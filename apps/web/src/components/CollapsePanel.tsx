/**
 * Description: Body of a collapsible section that grows open and shrinks closed instead of snapping.
 * Index:
 *   - COLLAPSE_EXIT_MS: how long a closing panel stays mounted so its exit can play
 *   - CollapsePanel: wrapper that carries the `panelId` a CollapseToggle points at
 */
import { useEffect, useState, type ReactNode } from 'react'

export const COLLAPSE_EXIT_MS = 160

/**
 * Mounts its children while open and for a short exit after closing, then unmounts them,
 * so a closed section still costs nothing. A panel that is already open on first render
 * appears in place; only a panel opened by the user animates in. Closed panels are `inert`
 * for the length of the exit so focus cannot land in content that is on its way out.
 */
export function CollapsePanel({ open, id, children }: { open: boolean; id?: string; children: ReactNode }) {
  const [mounted, setMounted] = useState(open)
  const [openedByUser, setOpenedByUser] = useState(!open)
  if (open && !mounted) setMounted(true)
  if (!open && !openedByUser) setOpenedByUser(true)

  useEffect(() => {
    if (open) return
    const timer = window.setTimeout(() => setMounted(false), COLLAPSE_EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [open])

  if (!mounted) return null
  return (
    <div id={id} className="collapse-panel" data-state={open ? 'open' : 'closed'} data-animate-in={openedByUser || undefined} inert={!open}>
      <div className="collapse-panel-inner">{children}</div>
    </div>
  )
}
