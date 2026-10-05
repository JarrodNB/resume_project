/**
 * Description: Card for one part of the career library, with a count and an empty state.
 * The card starts collapsed; opening it is remembered in this browser.
 * Index:
 *   - LibrarySection: tone-colored titled card; shows `emptyText` when `count` is 0
 */
import type { ReactNode } from 'react'
import { SectionCard } from '@/components/SectionCard'
import type { SectionTone } from '@/components/sectionTones'
import { Badge } from '@/components/ui/badge'

interface LibrarySectionProps {
  sectionId: string
  tone: SectionTone
  title: string
  count: number
  emptyText: string
  children: ReactNode
}

/** Renders a titled, counted card around library entries. */
export function LibrarySection({ sectionId, tone, title, count, emptyText, children }: LibrarySectionProps) {
  return (
    <SectionCard sectionId={sectionId} tone={tone} title={title} badge={<Badge variant="secondary">{count}</Badge>}>
      {count === 0 ? <p className="text-sm text-muted-foreground">{emptyText}</p> : <div className="grid gap-3">{children}</div>}
    </SectionCard>
  )
}
