/**
 * Description: The opened body of an approved tailored section: contact lines, a summary
 * paragraph, or one card per role, project, or school.
 * Index:
 *   - SectionPreviewBody: the body for one section
 */
import { LibraryEntry } from '@/features/career-library/LibraryEntry'
import { formatDateRange } from '@/lib/formatDateRange'
import type { TailorSection } from './parseTailorTask'
import type { TailorSectionType } from './sectionOrder'

/** Renders one section's content with its headings and bullets. */
export function SectionPreviewBody({ section }: { section: TailorSection }) {
  const content = isRecord(section.content) ? section.content : {}
  if (section.sectionType === 'contact') return <ContactBody content={content} />
  if (section.sectionType === 'summary') {
    return <p className="text-sm">{typeof content.text === 'string' ? content.text : ''}</p>
  }
  if (section.sectionType === 'skills') {
    const names = items(content)
      .map((item) => (isRecord(item) && typeof item.name === 'string' ? item.name : ''))
      .filter(Boolean)
    return <p className="text-sm">{names.join(', ')}</p>
  }
  return (
    <div className="grid gap-3">
      {items(content).map((item, index) => (
        <EntryPreview key={index} sectionType={section.sectionType} item={item} />
      ))}
    </div>
  )
}

/** Name, then the contact line and links. */
function ContactBody({ content }: { content: Record<string, unknown> }) {
  const line = [content.email, content.phone, content.location].filter(isString).join(' · ')
  const links = Array.isArray(content.links) ? content.links.filter(isString) : []
  return (
    <div className="grid gap-1 text-sm">
      {isString(content.full_name) && <p className="font-medium">{content.full_name}</p>}
      {line && <p className="text-muted-foreground">{line}</p>}
      {links.length > 0 && <p>{links.join(' · ')}</p>}
    </div>
  )
}

/** One role, project, or school, with bullets under a role. */
function EntryPreview({ sectionType, item }: { sectionType: TailorSectionType; item: unknown }) {
  if (!isRecord(item)) return null
  const highlights = Array.isArray(item.highlights) ? item.highlights.filter(isString) : []
  const dates = formatDateRange(stringOrNull(item.start_date), stringOrNull(item.end_date), {
    openEndedMeansPresent: item.is_current === true,
  })
  if (sectionType === 'experience') {
    return (
      <LibraryEntry
        tone="experience"
        heading={stringOr(item.title, 'Role')}
        subheading={[item.company, item.location].filter(isString).join(' · ')}
        dates={dates}
        description={stringOrNull(item.description)}
      >
        {highlights.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {highlights.map((highlight, index) => (
              <li key={index}>{highlight}</li>
            ))}
          </ul>
        )}
      </LibraryEntry>
    )
  }
  if (sectionType === 'projects') {
    return (
      <LibraryEntry
        tone="projects"
        heading={stringOr(item.name, 'Project')}
        subheading={[item.role, item.url].filter(isString).join(' · ')}
        dates={dates}
        description={stringOrNull(item.description)}
      />
    )
  }
  return (
    <LibraryEntry
      tone="education"
      heading={stringOr(item.institution, 'Education')}
      subheading={[item.degree, item.field_of_study].filter(isString).join(', ')}
      dates={dates}
      description={stringOrNull(item.description)}
    />
  )
}

/** The items of a list section. */
function items(content: Record<string, unknown>): unknown[] {
  return Array.isArray(content.items) ? content.items : []
}

/** True for a JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** True for a non-empty string. */
function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** A string field, or null. */
function stringOrNull(value: unknown): string | null {
  return isString(value) ? value : null
}

/** A string field, or a fallback. */
function stringOr(value: unknown, fallback: string): string {
  return isString(value) ? value : fallback
}
