/**
 * Description: The review form's working copy of a ParsedResume. Every entry, highlight, and
 * skill gets a stable `key` so it can be dragged (list indexes change as items move). The keys
 * are removed again before import, so the import payload is a plain ParsedResume.
 * Index:
 *   - DraftHighlight, DraftExperience, DraftProject, DraftEducation, DraftSkill, ReviewDraft
 *   - withDraftKey: copies an object with a new key
 *   - toReviewDraft: ParsedResume -> ReviewDraft
 *   - toParsedResume: ReviewDraft -> ParsedResume (keys removed)
 */
import type { ParsedEducation, ParsedExperience, ParsedProject, ParsedResume, ParsedSkill } from '../parsedResume'

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
export type DraftEducation = ParsedEducation & Keyed
export type DraftSkill = ParsedSkill & Keyed

export interface ReviewDraft extends Omit<ParsedResume, 'experiences' | 'projects' | 'educations' | 'skills'> {
  experiences: DraftExperience[]
  projects: DraftProject[]
  educations: DraftEducation[]
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
    experiences: parsedResume.experiences.map((experience) =>
      withDraftKey({ ...experience, highlights: experience.highlights.map((text) => withDraftKey({ text })) }),
    ),
    projects: parsedResume.projects.map(withDraftKey),
    educations: parsedResume.educations.map(withDraftKey),
    skills: parsedResume.skills.map(withDraftKey),
  }
}

/** Removes the `key` from a keyed object. */
function withoutKey<Value extends Keyed>({ key: _key, ...rest }: Value): Omit<Value, 'key'> {
  return rest
}

/** Turns the edited draft back into a ParsedResume for the import mutation. */
export function toParsedResume(draft: ReviewDraft): ParsedResume {
  return {
    ...draft,
    experiences: draft.experiences.map((experience) => ({
      ...withoutKey(experience),
      highlights: experience.highlights.map((highlight) => highlight.text),
    })),
    projects: draft.projects.map(withoutKey),
    educations: draft.educations.map(withoutKey),
    skills: draft.skills.map(withoutKey),
  }
}
