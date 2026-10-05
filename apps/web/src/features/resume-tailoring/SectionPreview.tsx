/**
 * Description: A read-only look at one approved tailored section, with a way to edit it again.
 * Editing again discards every section after it.
 * Index:
 *   - SectionPreview: the section's text and an "Edit again" button
 */
import { Button } from '@/components/ui/button'
import { SECTION_TITLES } from './sectionOrder'
import type { TailorSection } from './parseTailorTask'

interface SectionPreviewProps {
  section: TailorSection
  onReopen?: (sectionType: TailorSection['sectionType']) => void
  reopening?: boolean
}

/** Shows one decided section. "Edit again" reopens it and drops later sections. */
export function SectionPreview({ section, onReopen, reopening = false }: SectionPreviewProps) {
  return (
    <section className="grid gap-2 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium">{section.title || SECTION_TITLES[section.sectionType]}</h2>
        {onReopen && (
          <Button type="button" variant="ghost" size="sm" disabled={reopening} onClick={() => onReopen(section.sectionType)}>
            Edit again
          </Button>
        )}
      </div>
      {onReopen && <p className="text-xs text-muted-foreground">Editing this again removes every section after it.</p>}
      <div className="text-sm whitespace-pre-line">{previewText(section)}</div>
    </section>
  )
}

/** A short plain-text look at the section content. */
function previewText(section: TailorSection): string {
  const content = isRecord(section.content) ? section.content : {}
  if (section.sectionType === 'contact') {
    return [content.full_name, content.email, content.phone, content.location].filter(isString).join(' · ')
  }
  if (section.sectionType === 'summary') return typeof content.text === 'string' ? content.text : ''
  if (section.sectionType === 'skills') {
    return items(content).map((item) => (isRecord(item) && typeof item.name === 'string' ? item.name : '')).filter(Boolean).join(', ')
  }
  return items(content).map(entryLine).filter(Boolean).join('\n')
}

/** One experience, project, or education entry as a line plus its bullets. */
function entryLine(value: unknown): string {
  if (!isRecord(value)) return ''
  const heading = [value.title, value.company, value.name, value.institution].filter(isString).join(' · ')
  const highlights = Array.isArray(value.highlights) ? value.highlights.filter(isString) : []
  const description = typeof value.description === 'string' ? value.description : ''
  return [heading, ...highlights, description].filter(Boolean).join('\n')
}

/** The items of a list section. */
function items(content: Record<string, unknown>): unknown[] {
  return Array.isArray(content.items) ? content.items : []
}

/** True for a JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** True for a string. */
function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}
