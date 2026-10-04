/**
 * Description: One entry in the career library (a role, project, or school), tinted with its
 * section's color.
 * Index:
 *   - LibraryEntry: heading, subheading, date range, description, optional actions, and extra content
 */
import type { ReactNode } from 'react'
import { SECTION_TONES, type SectionTone } from '@/components/sectionTones'
import { cn } from '@/lib/utils'

interface LibraryEntryProps {
  tone: SectionTone
  heading: string
  subheading?: string | null
  dates?: string
  description?: string | null
  actions?: ReactNode
  children?: ReactNode
}

/** Renders a library entry; empty optional parts are left out. */
export function LibraryEntry({ tone, heading, subheading, dates, description, actions, children }: LibraryEntryProps) {
  return (
    <article className={cn('grid gap-1 rounded-lg border p-3', SECTION_TONES[tone].entry)}>
      <div className="flex items-start gap-2">
        <div className="flex flex-1 flex-wrap items-baseline justify-between gap-x-4">
          <h3 className="font-medium">{heading}</h3>
          {dates && <span className="text-sm text-muted-foreground">{dates}</span>}
        </div>
        {actions}
      </div>
      {subheading && <p className="text-sm text-muted-foreground">{subheading}</p>}
      {description && <p className="text-sm">{description}</p>}
      {children}
    </article>
  )
}
