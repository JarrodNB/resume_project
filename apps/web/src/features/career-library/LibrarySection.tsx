/**
 * Description: Card for one part of the career library, with a count, an add button, and an
 * empty state. The card starts collapsed; opening it is remembered in this browser.
 * Manual add and AI review actions share one toolbar above the saved records. Reviewed sections
 * also show how many review questions are waiting on the user, even while collapsed.
 * Index:
 *   - LibrarySection: tone-colored titled card; shows `emptyText` when `count` is 0
 */
import type { ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { SectionCard } from '@/components/SectionCard'
import type { SectionTone } from '@/components/sectionTones'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ReviewSection } from './libraryReviewTargets'
import { ReviewQuestionsBadge } from './ReviewQuestionsBadge'

interface LibrarySectionProps {
  sectionId: string
  tone: SectionTone
  title: string
  count: number
  emptyText: string
  addLabel: string
  onAdd: () => void
  reviewActions?: ReactNode
  reviewSection?: ReviewSection
  children: ReactNode
}

/** Renders a titled, counted card. Add stays available when the section is empty. */
export function LibrarySection({ sectionId, tone, title, count, emptyText, addLabel, onAdd, reviewActions, reviewSection, children }: LibrarySectionProps) {
  return (
    <SectionCard sectionId={sectionId} tone={tone} title={title} badge={<><Badge variant="secondary">{count}</Badge>{reviewSection && <ReviewQuestionsBadge section={reviewSection} />}</>}>
      <div className="grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={onAdd}>
            <Plus /> {addLabel}
          </Button>
          {reviewActions}
        </div>
        {count === 0 ? <p className="text-sm text-muted-foreground">{emptyText}</p> : children}
      </div>
    </SectionCard>
  )
}
