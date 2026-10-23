/**
 * Description: Maps saved resume sections into content shared by the PDF preview and both export formats.
 * Contact becomes the header. Empty sections are left out so the page matches an export.
 * Index:
 *   - ResumePdfModel, ResumePdfBlock, ResumePdfEntry: the document's data
 *   - ResumePdfSourceSection: one saved section, in stored order
 *   - buildResumePdfModel: sections to that model
 */
import { formatCertificationDates } from '@/lib/formatCertificationDates'
import { formatDateRange } from '@/lib/formatDateRange'
import { parsedLinks, type ParsedLink } from '@/features/resume-import/parsedResume'
import type { TailorSectionType } from './sectionOrder'

export interface ResumePdfEntry {
  heading: string
  meta: string
  dates: string
  body: string
  bullets: string[]
}

export interface ResumePdfBlock {
  title: string
  text: string
  entries: ResumePdfEntry[]
}

export interface ResumePdfModel {
  name: string
  contactLine: string
  links: ParsedLink[]
  blocks: ResumePdfBlock[]
}

export interface ResumePdfSourceSection {
  sectionType: TailorSectionType
  title: string
  content: unknown
}

/** The header and body blocks for one resume, in the order the sections are stored. */
export function buildResumePdfModel(sections: ResumePdfSourceSection[]): ResumePdfModel {
  const contact = sections.find((section) => section.sectionType === 'contact')
  const record = isRecord(contact?.content) ? contact.content : {}
  return {
    name: text(record.full_name),
    contactLine: [record.email, record.phone, record.location].map(text).filter(Boolean).join(' · '),
    links: parsedLinks(record.links),
    blocks: sections.flatMap((section) => {
      const block = blockFrom(section)
      return block ? [block] : []
    }),
  }
}

/** One body section, or nothing when it has no text to print. */
function blockFrom(section: ResumePdfSourceSection): ResumePdfBlock | null {
  const content = isRecord(section.content) ? section.content : {}
  if (section.sectionType === 'contact') return null
  if (section.sectionType === 'summary') {
    const summary = text(content.text)
    return summary ? { title: section.title, text: summary, entries: [] } : null
  }
  if (section.sectionType === 'skills') {
    const skills = skillsText(items(content))
    return skills ? { title: section.title, text: skills, entries: [] } : null
  }
  const entries = items(content).flatMap((item) => {
    const entry = entryFrom(section.sectionType, item)
    return entry ? [entry] : []
  })
  return entries.length > 0 ? { title: section.title, text: '', entries } : null
}

/** One role, project, or school. */
function entryFrom(sectionType: TailorSectionType, value: unknown): ResumePdfEntry | null {
  if (!isRecord(value)) return null
  if (sectionType === 'experience') return experienceEntry(value)
  if (sectionType === 'projects') return projectEntry(value)
  if (sectionType === 'certifications') return certificationEntry(value)
  if (sectionType === 'education') return educationEntry(value)
  return null
}

/** A role: title and company, dates, and bullets. */
function experienceEntry(item: Record<string, unknown>): ResumePdfEntry | null {
  const title = text(item.title)
  const company = text(item.company)
  const location = text(item.location)
  const dates = formatDateRange(textOrNull(item.start_date), textOrNull(item.end_date), { openEndedMeansPresent: item.is_current === true })
  const body = text(item.description)
  const bullets = stringList(item.highlights)
  if (!title && !company && !location && !dates && !body && bullets.length === 0) return null
  return { heading: title || company || 'Role', meta: [title ? company : '', location].filter(Boolean).join(' · '), dates, body, bullets }
}

/** A project: name, role, and description. */
function projectEntry(item: Record<string, unknown>): ResumePdfEntry | null {
  const name = text(item.name)
  const meta = [text(item.role), text(item.url)].filter(Boolean).join(' · ')
  const dates = formatDateRange(textOrNull(item.start_date), textOrNull(item.end_date))
  const body = text(item.description)
  if (!name && !meta && !dates && !body) return null
  return { heading: name || 'Project', meta, dates, body, bullets: [] }
}

/** A school: institution, degree, and description. */
function educationEntry(item: Record<string, unknown>): ResumePdfEntry | null {
  const institution = text(item.institution)
  const meta = [text(item.degree), text(item.field_of_study)].filter(Boolean).join(', ')
  const dates = formatDateRange(textOrNull(item.start_date), textOrNull(item.end_date))
  const body = text(item.description)
  if (!institution && !meta && !dates && !body) return null
  return { heading: institution || 'Education', meta, dates, body, bullets: [] }
}

/** Skills on one or more lines, grouped when a category is set. */
function skillsText(values: unknown[]): string {
  const skills = values.flatMap((value) => {
    if (!isRecord(value)) return []
    const name = text(value.name)
    return name ? [{ name, category: text(value.category) }] : []
  })
  const groups = new Map<string, string[]>()
  for (const skill of skills) {
    const names = groups.get(skill.category) ?? []
    names.push(skill.name)
    groups.set(skill.category, names)
  }
  if (groups.size === 0) return ''
  if (groups.size === 1 && groups.has('')) return groups.get('')?.join(', ') ?? ''
  return [...groups.entries()].map(([category, names]) => (category ? `${category}: ${names.join(', ')}` : names.join(', '))).join('\n')
}

/** True for a JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A trimmed string field, or nothing. */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** A trimmed string, or null when it is blank. */
function textOrNull(value: unknown): string | null {
  return text(value) || null
}

/** The items array of a section, or none. */
function items(content: Record<string, unknown>): unknown[] {
  return Array.isArray(content.items) ? content.items : []
}

/** The string values in a list, with blanks removed. */
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : []
}

/** A certification: issuer, credential identifiers, explicit issue and expiry dates. */
function certificationEntry(item: Record<string, unknown>): ResumePdfEntry | null {
  const name = text(item.name)
  const meta = [text(item.issuer), text(item.credential_id), text(item.credential_url)].filter(Boolean).join(' · ')
  const dates = formatCertificationDates(textOrNull(item.issued_date), textOrNull(item.expiry_date))
  const body = text(item.description)
  if (!name && !meta && !dates && !body) return null
  return { heading: name || 'Certification', meta, dates, body, bullets: [] }
}
