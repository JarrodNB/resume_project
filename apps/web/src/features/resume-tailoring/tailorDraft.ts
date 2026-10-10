/**
 * Description: Turns one tailored section's JSON into the draft the resume-import review fields
 * edit, and back into the JSON the tailor mutation stores. Draft keys never leave the browser.
 * Index:
 *   - sectionDraftFromContent / contentFromSectionDraft: one section, both ways
 *   - SectionDraft: the editable form of one section
 */
import type { ParsedCertification, ParsedContactInfo, ParsedEducation, ParsedExperience, ParsedProject, ParsedSkill } from '@/features/resume-import/parsedResume'
import { emptyCertification, emptyEducation, emptyExperience, emptyProject, parsedLinks } from '@/features/resume-import/parsedResume'
import { withDraftKey, type DraftCertification, type DraftEducation, type DraftExperience, type DraftProject, type DraftSkill } from '@/features/resume-import/review/reviewDraft'
import type { TailorSectionType } from './sectionOrder'

export type SectionDraft =
  | { kind: 'contact'; contact: ParsedContactInfo }
  | { kind: 'summary'; text: string | null }
  | { kind: 'experience'; items: DraftExperience[] }
  | { kind: 'projects'; items: DraftProject[] }
  | { kind: 'education'; items: DraftEducation[] }
  | { kind: 'certifications'; items: DraftCertification[] }
  | { kind: 'skills'; items: DraftSkill[] }

/** A draft the review fields can edit. Missing fields are filled in. */
export function sectionDraftFromContent(sectionType: TailorSectionType, content: unknown): SectionDraft {
  const record = isRecord(content) ? content : {}
  if (sectionType === 'contact') return { kind: 'contact', contact: contactFrom(record) }
  if (sectionType === 'summary') return { kind: 'summary', text: typeof record.text === 'string' ? record.text : '' }
  if (sectionType === 'experience') return { kind: 'experience', items: items(record).map(experienceFrom) }
  if (sectionType === 'projects') return { kind: 'projects', items: items(record).map(projectFrom) }
  if (sectionType === 'certifications') return { kind: 'certifications', items: items(record).map(certificationFrom) }
  if (sectionType === 'education') return { kind: 'education', items: items(record).map(educationFrom) }
  return { kind: 'skills', items: items(record).map(skillFrom) }
}

/** The JSON content for a submit or save, without drag-and-drop keys. */
export function contentFromSectionDraft(draft: SectionDraft): Record<string, unknown> {
  if (draft.kind === 'contact') return { ...draft.contact }
  if (draft.kind === 'summary') return { text: draft.text ?? '' }
  if (draft.kind === 'experience') return { items: draft.items.map(({ key: _key, highlights, ...item }) => ({ ...item, highlights: highlights.map((highlight) => highlight.text) })) }
  if (draft.kind === 'skills') return { items: draft.items.map(({ key: _key, ...item }) => item) }
  return { items: draft.items.map(({ key: _key, ...item }) => item) }
}

/** True for a JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The items array of a section, or none. */
function items(content: Record<string, unknown>): unknown[] {
  return Array.isArray(content.items) ? content.items : []
}

/** Contact fields with defaults, matching ContactFields. */
function contactFrom(content: Record<string, unknown>): ParsedContactInfo {
  return {
    full_name: stringOrNull(content.full_name),
    email: stringOrNull(content.email),
    phone: stringOrNull(content.phone),
    location: stringOrNull(content.location),
    links: parsedLinks(content.links),
  }
}

/** One experience, with a key on the role and each highlight. */
function experienceFrom(value: unknown): DraftExperience {
  const experience = { ...emptyExperience(), ...(isRecord(value) ? (value as Partial<ParsedExperience>) : {}) }
  const highlights = Array.isArray(experience.highlights) ? experience.highlights.filter((text): text is string => typeof text === 'string') : []
  return withDraftKey({ ...experience, highlights: highlights.map((text) => withDraftKey({ text })) })
}

/** One project with a key. */
function projectFrom(value: unknown): DraftProject {
  return withDraftKey({ ...emptyProject(), ...(isRecord(value) ? (value as Partial<ParsedProject>) : {}) })
}

/** One education entry with a key. */
function educationFrom(value: unknown): DraftEducation {
  return withDraftKey({ ...emptyEducation(), ...(isRecord(value) ? (value as Partial<ParsedEducation>) : {}) })
}

/** One skill with a key. */
function skillFrom(value: unknown): DraftSkill {
  const skill = isRecord(value) ? (value as Partial<ParsedSkill>) : {}
  return withDraftKey({ name: typeof skill.name === 'string' ? skill.name : '', category: typeof skill.category === 'string' ? skill.category : null })
}

/** A string field, or null. */
function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** One certification entry with editable defaults and a stable key. */
function certificationFrom(value: unknown): DraftCertification {
  return withDraftKey({ ...emptyCertification(), ...(isRecord(value) ? (value as Partial<ParsedCertification>) : {}) })
}
