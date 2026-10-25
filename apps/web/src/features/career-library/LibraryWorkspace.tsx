/** Keeps one shared set of section reviews and one selected AI edit beside the library.
 * Selection stores only identity; the panel receives current text and revisions from Rails data.
 */
import { useRef, useState, type ReactNode } from 'react'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { setSectionOpen } from '@/lib/openSections'
import { LibraryWorkspaceContext } from './LibraryWorkspaceContext'
import { libraryReviewTargets, targetElementId, targetKey, type LibraryReviewTarget } from './libraryReviewTargets'
import { useLibraryReview } from './useLibraryReview'

export function LibraryWorkspace({ library, movingHighlight = false, children }: { library: CareerLibraryQuery; movingHighlight?: boolean; children: ReactNode }) {
  const summary = useLibraryReview('summary', library.me.summary ?? '')
  const experience = useLibraryReview('experience', JSON.stringify(library.experiences))
  const projects = useLibraryReview('projects', JSON.stringify(library.projects))
  const facts = useLibraryReview('facts', JSON.stringify(library.libraryFacts))
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [mode, setMode] = useState<'improve' | 'review'>('improve')
  const opener = useRef<HTMLElement | null>(null)
  const targets = libraryReviewTargets(library)
  function selectTarget(target: LibraryReviewTarget, trigger?: HTMLElement, mode: 'improve' | 'review' = 'improve') {
    if (trigger) opener.current = trigger
    setSelectedKey(targetKey(target))
    setMode(mode)
    setSectionOpen(target.sectionId, true)
    requestAnimationFrame(() => {
      const source = document.getElementById(targetElementId(target))
      if (!trigger) opener.current = source?.querySelector('button') ?? null
      document.getElementById('library-ai-heading')?.focus({ preventScroll: true })
    })
  }
  function close() {
    setSelectedKey(null)
    requestAnimationFrame(() => { if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }) })
  }
  const reviews = { summary, experience: { ...experience, assessments: experience.assessments.map((item) => movingHighlight ? { ...item, stale: true } : item) }, projects, facts }
  return <LibraryWorkspaceContext value={{ targets, reviews, selectedKey, mode, mobileOpen: selectedKey !== null, movingHighlight, selectTarget, close }}>{children}</LibraryWorkspaceContext>
}
