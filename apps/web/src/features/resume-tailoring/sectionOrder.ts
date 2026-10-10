/**
 * Description: The fixed order of a tailored resume, matching services/ai/tailoring/section_catalog.py.
 * Index:
 *   - SECTION_ORDER / SECTION_TITLES: display order and titles
 *   - TailorSectionType: one section of that order
 *   - nextSectionType: the first section not yet decided
 *   - sectionBeingWritten: the section the worker is writing while the task is queued
 */

export const SECTION_ORDER = ['contact', 'summary', 'experience', 'projects', 'education', 'certifications', 'skills'] as const

export type TailorSectionType = (typeof SECTION_ORDER)[number]

export const SECTION_TITLES: Record<TailorSectionType, string> = {
  contact: 'Contact',
  summary: 'Summary',
  experience: 'Experience',
  projects: 'Projects',
  education: 'Education',
  certifications: 'Certifications',
  skills: 'Skills',
}

/** The next section to write, or null when every section has been decided. */
export function nextSectionType(done: readonly string[]): TailorSectionType | null {
  return SECTION_ORDER.find((sectionType) => !done.includes(sectionType)) ?? null
}

/** Which section a queued task is writing, from the approved list and the submission in flight. */
export function sectionBeingWritten(input: unknown): TailorSectionType {
  const record = isRecord(input) ? input : {}
  const approved = Array.isArray(record.approved_sections) ? record.approved_sections : []
  const done = approved.map(sectionTypeOf).filter((sectionType): sectionType is string => sectionType !== null)
  const pending = isRecord(record.pending_section) ? record.pending_section : null
  const pendingType = pending ? asSectionType(pending.section_type) : null
  if (pending && (pending.action === 'reopen' || pending.action === 'write_anyway') && pendingType) return pendingType
  const afterPending = pendingType ? [...done, pendingType] : done
  return nextSectionType(afterPending) ?? 'skills'
}

/** A section type string, or null when it isn't one we write. */
export function asSectionType(value: unknown): TailorSectionType | null {
  return SECTION_ORDER.find((sectionType) => sectionType === value) ?? null
}

/** True for a JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** section_type from a section or a pending submission. */
function sectionTypeOf(value: unknown): string | null {
  return isRecord(value) && typeof value.section_type === 'string' ? value.section_type : null
}
