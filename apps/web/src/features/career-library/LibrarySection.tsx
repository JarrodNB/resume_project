/**
 * Description: One part of the career library page: a bold heading on an ink rule, with the
 * section's actions beside it and its records always showing below. Manual add and AI review
 * share the heading row. Reviewed sections show how many questions are waiting on the user.
 * Career context is drawn "off the line" with a dashed rule because it never prints on a resume.
 * Index:
 *   - LibrarySectionFrame: heading row and records for any section
 *   - LibrarySection: the same frame with a count-based empty state and an add button
 */
import type { ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ReviewSection } from './libraryReviewTargets'
import { ReviewQuestionsBadge } from './ReviewQuestionsBadge'

interface LibrarySectionFrameProps {
  sectionId: string
  title: string
  actions?: ReactNode
  reviewSection?: ReviewSection
  offLine?: boolean
  children: ReactNode
}

/** Renders a section heading row above its records. */
export function LibrarySectionFrame({ sectionId, title, actions, reviewSection, offLine = false, children }: LibrarySectionFrameProps) {
  return (
    <section id={sectionId} className={cn('library-section', offLine && 'is-off-line')} aria-labelledby={`${sectionId}-heading`}>
      <div className="library-section-head">
        <div className="library-section-title">
          <h2 id={`${sectionId}-heading`}>{title}</h2>
          {reviewSection && <ReviewQuestionsBadge section={reviewSection} />}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

interface LibrarySectionProps extends Omit<LibrarySectionFrameProps, 'actions'> {
  count: number
  emptyText: string
  addLabel: string
  onAdd: () => void
  reviewActions?: ReactNode
  /** A plain line under the heading, shown even when the section is empty. */
  note?: string
}

/** Renders a section with an add button. Add stays available when the section is empty. */
export function LibrarySection({ count, emptyText, addLabel, onAdd, reviewActions, note, children, ...frame }: LibrarySectionProps) {
  return (
    <LibrarySectionFrame {...frame} actions={<>
      {reviewActions}
      <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={onAdd}>
        <Plus /> {addLabel}
      </Button>
    </>}>
      {note && <p className="library-section-note">{note}</p>}
      {count === 0 ? <p className="library-section-empty">{emptyText}</p> : children}
    </LibrarySectionFrame>
  )
}
