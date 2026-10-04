/**
 * Description: The review draft gives every draggable item a unique key and converts back to
 * the exact ParsedResume, so drag-and-drop never changes the import payload.
 */
import { expect, it } from 'vitest'
import { buildParsedResume } from '@/test/parsedResumeFixture'
import { toParsedResume, toReviewDraft } from './reviewDraft'
import { highlightGroups } from './useReviewDragHandlers'

it('keys every entry, highlight, and skill uniquely', () => {
  const draft = toReviewDraft(buildParsedResume())
  const keys = [
    ...draft.experiences.flatMap((experience) => [experience.key, ...experience.highlights.map((highlight) => highlight.key)]),
    ...draft.projects.map((project) => project.key),
    ...draft.educations.map((education) => education.key),
    ...draft.skills.map((skill) => skill.key),
  ]
  expect(keys.every(Boolean)).toBe(true)
  expect(new Set(keys).size).toBe(keys.length)
})

it('converts back to the original parsed resume', () => {
  const parsedResume = buildParsedResume()
  expect(toParsedResume(toReviewDraft(parsedResume))).toEqual(parsedResume)
})

it('groups highlight ids by role', () => {
  const draft = toReviewDraft(buildParsedResume())
  const [experience] = draft.experiences
  expect(highlightGroups(draft.experiences)[`highlights-of:${experience.key}`]).toEqual(
    experience.highlights.map((highlight) => `highlight:${highlight.key}`),
  )
})
