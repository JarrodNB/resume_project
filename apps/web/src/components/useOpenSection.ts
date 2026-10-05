/**
 * Description: Reads and toggles one remembered section from the open-section store.
 * Index:
 *   - useOpenSection: open flag, toggle, and the id of the controlled region
 */
import { useCallback, useId, useSyncExternalStore } from 'react'
import { isSectionOpen, setSectionOpen, subscribeOpenSections } from '@/lib/openSections'

/** A section with no stored choice is collapsed, including during server render. */
function closedByDefault() {
  return false
}

/** Whether `sectionId` is open, plus a toggle and a DOM id for `aria-controls`. */
export function useOpenSection(sectionId: string) {
  const getSnapshot = useCallback(() => isSectionOpen(sectionId), [sectionId])
  const open = useSyncExternalStore(subscribeOpenSections, getSnapshot, closedByDefault)
  const panelId = useId()
  const toggle = useCallback(() => setSectionOpen(sectionId, !isSectionOpen(sectionId)), [sectionId])

  return { open, toggle, panelId }
}
