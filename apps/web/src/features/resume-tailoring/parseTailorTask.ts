/** Reads completed task sections and omission warnings for the draft editor. */
import { asSectionType, SECTION_TITLES, type TailorSectionType } from './sectionOrder'

export interface TailorSection {
  sectionType: TailorSectionType
  title: string
  content: unknown
  omitted: boolean
}

/** The finished draft's sections (omitted ones are already gone). */
export function finishedSectionsFromResult(result: unknown): TailorSection[] {
  const sections = isRecord(result) && Array.isArray(result.sections) ? result.sections : []
  return sections.map(parseSection).filter((section): section is TailorSection => section !== null && !section.omitted)
}

/** Warnings on a finished draft. */
export function warningsFromResult(result: unknown): string[] {
  return isRecord(result) ? stringList(result.warnings) : []
}

/** Only a new-format task can provide an editable resume. */
export function markdownFromResult(result: unknown): string {
  return isRecord(result) && typeof result.markdown === 'string' ? result.markdown : ''
}

/** One section object, or null when its type is unknown. */
function parseSection(value: unknown): TailorSection | null {
  if (!isRecord(value)) return null
  const sectionType = asSectionType(value.section_type)
  if (!sectionType) return null
  return {
    sectionType,
    title: typeof value.title === 'string' ? value.title : SECTION_TITLES[sectionType],
    content: value.content ?? {},
    omitted: value.omitted === true,
  }
}

/** String entries of a list. */
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** True for a JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
