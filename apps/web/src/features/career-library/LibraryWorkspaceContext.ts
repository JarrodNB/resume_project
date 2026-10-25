/** Shared selection and review state for the library records and their AI workspace. */
import { createContext, useContext } from 'react'
import type { ReviewSection, LibraryReviewTarget } from './libraryReviewTargets'
import type { useLibraryReview } from './useLibraryReview'

export interface LibraryWorkspaceState {
  targets: LibraryReviewTarget[]
  reviews: Record<ReviewSection, ReturnType<typeof useLibraryReview>>
  selectedKey: string | null
  mode: 'improve' | 'review'
  mobileOpen: boolean
  movingHighlight: boolean
  selectTarget: (target: LibraryReviewTarget, trigger?: HTMLElement, mode?: 'improve' | 'review') => void
  close: () => void
}
export const LibraryWorkspaceContext = createContext<LibraryWorkspaceState | null>(null)
export function useLibraryWorkspace() {
  const value = useContext(LibraryWorkspaceContext)
  if (!value) throw new Error('Library AI controls require LibraryWorkspace.')
  return value
}
