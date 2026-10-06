/**
 * Description: Which page sections the user has opened. The choice is kept in localStorage;
 * a section that is not listed stays collapsed.
 * Index:
 *   - OPEN_SECTIONS_STORAGE_KEY: localStorage key for the open section ids
 *   - isSectionOpen: whether one section id is in the stored list
 *   - setSectionOpen: adds or removes one section id and notifies subscribers
 *   - subscribeOpenSections: listens for those updates
 */

import { productStorageKey } from './productName'

export const OPEN_SECTIONS_STORAGE_KEY = productStorageKey('openSections')

const listeners = new Set<() => void>()

/** Reads the stored ids, or nothing when the value is missing or not a list of strings. */
function readOpenIds(): string[] {
  try {
    const stored = localStorage.getItem(OPEN_SECTIONS_STORAGE_KEY)
    if (!stored) return []
    const parsed: unknown = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    return []
  }
}

/** Whether this section has been opened and not collapsed again. */
export function isSectionOpen(sectionId: string): boolean {
  return readOpenIds().includes(sectionId)
}

/** Remembers a section as open or collapsed, then tells subscribers. */
export function setSectionOpen(sectionId: string, open: boolean) {
  const ids = new Set(readOpenIds())
  if (open) ids.add(sectionId)
  else ids.delete(sectionId)
  localStorage.setItem(OPEN_SECTIONS_STORAGE_KEY, JSON.stringify([...ids]))
  for (const listener of [...listeners]) listener()
}

/** Subscribes to open-section changes. Returns an unsubscribe function. */
export function subscribeOpenSections(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
