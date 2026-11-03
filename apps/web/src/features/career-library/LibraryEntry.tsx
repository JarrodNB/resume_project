/**
 * Description: How records look in the career library. Projects, schools and certifications are
 * plain ruled entries. Roles are stops on the career line, with their dates in a column beside it.
 * Index:
 *   - LibraryEntry: heading, subheading, date range, description, optional actions, and extra content
 *   - CareerStop: one role on the line; a role with no end date is the current stop
 */
import type { ReactNode } from 'react'

interface LibraryEntryProps {
  heading: string
  subheading?: string | null
  dates?: string
  description?: string | null
  actions?: ReactNode
  children?: ReactNode
}

/** Renders a library entry; empty optional parts are left out. */
export function LibraryEntry({ heading, subheading, dates, description, actions, children }: LibraryEntryProps) {
  return (
    <article className="library-entry">
      <div className="library-entry-head">
        <div className="min-w-0">
          <h3>{heading}</h3>
          {subheading && <p className="library-entry-sub">{subheading}</p>}
        </div>
        {dates && <span className="library-entry-dates">{dates}</span>}
        {actions}
      </div>
      {description && <p className="library-entry-description">{description}</p>}
      {children}
    </article>
  )
}

/** Renders one role as a stop on the career line, with its details below the title. */
export function CareerStop({ heading, subheading, dates, current = false, actions, children }: Omit<LibraryEntryProps, 'description'> & { current?: boolean }) {
  return (
    <article className="career-stop" data-current={current || undefined}>
      <span className="career-stop-mark" aria-hidden />
      <div className="career-stop-body">
        <div className="career-stop-head">
          <div className="min-w-0">
            <h3>{heading}</h3>
            {subheading && <p className="library-entry-sub">{subheading}</p>}
            {dates && <p className="career-stop-dates">{dates}</p>}
          </div>
          {actions}
        </div>
        {children}
      </div>
    </article>
  )
}
