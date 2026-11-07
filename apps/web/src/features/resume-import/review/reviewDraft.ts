/** The review form gives entries and highlights stable keys for editing and dragging.
 * Shared converters remove those browser-only keys before import or tailored resume saves.
 */
import type { ParsedCertification, ParsedEducation, ParsedExperience, ParsedProject, ParsedResume, ParsedSkill } from '../parsedResume'

interface Keyed {
  key: string
}

export interface DraftHighlight extends Keyed {
  text: string
}

export interface DraftExperience extends Omit<ParsedExperience, 'highlights'>, Keyed {
  highlights: DraftHighlight[]
}

export type DraftProject = ParsedProject & Keyed
export type DraftCertification = ParsedCertification & Keyed
export type DraftEducation = ParsedEducation & Keyed
export type DraftSkill = ParsedSkill & Keyed

export interface ReviewDraft extends Omit<ParsedResume, 'experiences' | 'projects' | 'educations' | 'certifications' | 'skills'> {
  experiences: DraftExperience[]
  projects: DraftProject[]
  educations: DraftEducation[]
  certifications: DraftCertification[]
  skills: DraftSkill[]
}

/** Returns a copy of `value` with a new unique key. */
export function withDraftKey<Value extends object>(value: Value): Value & Keyed {
  return { ...value, key: crypto.randomUUID() }
}

/** Builds the draft for a parse, giving every entry, highlight, and skill a key. */
export function toReviewDraft(parsedResume: ParsedResume): ReviewDraft {
  return {
    ...parsedResume,
    experiences: parsedResume.experiences.map(toDraftExperience),
    projects: parsedResume.projects.map(withDraftKey),
    educations: parsedResume.educations.map(withDraftKey),
    certifications: (parsedResume.certifications ?? []).map(withDraftKey),
    skills: parsedResume.skills.map(withDraftKey),
  }
}

/** Removes the `key` from a keyed object. */
export function withoutDraftKey<Value extends Keyed>({ key: _key, ...rest }: Value): Omit<Value, 'key'> {
  return rest
}

/** Turns the edited draft back into a ParsedResume for the import mutation. */
export function toParsedResume(draft: ReviewDraft): ParsedResume {
  return {
    ...draft,
    experiences: draft.experiences.map(toParsedExperience),
    projects: draft.projects.map(withoutDraftKey),
    educations: draft.educations.map(withoutDraftKey),
    certifications: draft.certifications.map(withoutDraftKey),
    skills: draft.skills.map(withoutDraftKey),
  }
}

/** Gives a role and each highlight stable browser-only editing keys. */
export function toDraftExperience(experience: ParsedExperience): DraftExperience {
  return withDraftKey({ ...experience, highlights: experience.highlights.map((text) => withDraftKey({ text })) })
}

/** Restores a role's plain highlights and removes its browser-only editing key. */
export function toParsedExperience(experience: DraftExperience): ParsedExperience {
  return { ...withoutDraftKey(experience), highlights: experience.highlights.map((highlight) => highlight.text) }
}
