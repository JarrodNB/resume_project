/** Connects editable career details to their saved text and the section that contains it.
 * Targets are rebuilt from current records so edits never rely on a stale selection snapshot.
 */
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'

export type ReviewSection = 'summary' | 'experience' | 'projects' | 'facts'
export interface LibraryReviewTarget {
  kind: string
  recordId: string
  section: ReviewSection
  sectionId: string
  title: string
  fieldLabel: string
  text: string
  sourceRevision: string
}
export const REVIEW_SECTIONS: Record<ReviewSection, string> = { summary: 'Summary', experience: 'Experience', projects: 'Projects', facts: 'Career context' }
export const targetKey = (target: { kind: string; recordId: string }) => `${target.kind}:${target.recordId}`
export const targetElementId = (target: { kind: string; recordId: string }) => `library-detail-${targetKey(target)}`

export function libraryReviewTargets(library: CareerLibraryQuery): LibraryReviewTarget[] {
  const targets: LibraryReviewTarget[] = []
  if (library.me.summary) targets.push({ kind: 'user', recordId: library.me.id, section: 'summary', sectionId: 'library.profile', title: library.me.name || 'Your profile', fieldLabel: 'Summary', text: library.me.summary, sourceRevision: library.me.summary })
  for (const entry of library.experiences) {
    const base = { section: 'experience' as const, sectionId: 'library.experience', title: `${entry.title} at ${entry.company}`, sourceRevision: JSON.stringify(entry) }
    if (entry.description) targets.push({ ...base, kind: 'experience', recordId: entry.id, fieldLabel: 'Role description', text: entry.description })
    entry.highlights.forEach((highlight, index) => targets.push({ ...base, kind: 'experience_highlight', recordId: highlight.id, fieldLabel: `Highlight ${index + 1}`, text: highlight.content }))
  }
  for (const entry of library.projects) if (entry.description) targets.push({ kind: 'project', recordId: entry.id, section: 'projects', sectionId: 'library.projects', title: entry.name, fieldLabel: 'Project description', text: entry.description, sourceRevision: JSON.stringify(entry) })
  for (const entry of library.libraryFacts) targets.push({ kind: 'library_fact', recordId: entry.id, section: 'facts', sectionId: 'library.facts', title: entry.requirement, fieldLabel: 'Saved response', text: entry.response, sourceRevision: JSON.stringify(entry) })
  return targets
}
