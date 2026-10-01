/**
 * Description: One entry in the career library (a role, project, or school).
 * Index:
 *   - LibraryEntry: heading, subheading, date range, description, and optional extra content
 */
import type { ReactNode } from 'react'

interface LibraryEntryProps {
  heading: string
  subheading?: string | null
  dates?: string
  description?: string | null
  children?: ReactNode
}

/** Renders a library entry; empty optional parts are left out. */
export function LibraryEntry({ heading, subheading, dates, description, children }: LibraryEntryProps) {
  return (
    <article className="grid gap-1 border-b py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h3 className="font-medium">{heading}</h3>
        {dates && <span className="text-sm text-muted-foreground">{dates}</span>}
      </div>
      {subheading && <p className="text-sm text-muted-foreground">{subheading}</p>}
      {description && <p className="text-sm">{description}</p>}
      {children}
    </article>
  )
}
