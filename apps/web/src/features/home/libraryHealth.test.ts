/** Checks library health counts and the one next step it suggests. */
import { expect, it } from 'vitest'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { libraryHealth, type ReviewsBySection, type SectionReview } from './libraryHealth'

const emptyReview: SectionReview = { assessments: [] }
const noReviews: ReviewsBySection = { summary: emptyReview, experience: emptyReview, projects: emptyReview, career_contexts: emptyReview }

function libraryWith(overrides: Partial<CareerLibraryQuery> = {}): CareerLibraryQuery {
  return {
    me: { id: 'u1', name: 'Jane', contactEmail: null, phone: null, location: null, links: [], summary: null, includeSummary: true },
    experiences: [{ id: 'e1', company: 'Acme', title: 'Engineer', location: null, startDate: null, endDate: null, description: 'Built things',
      highlights: [{ id: 'h1', content: 'Cut costs', position: 1 }, { id: 'h2', content: 'Shipped X', position: 2 }] }],
    projects: [], educations: [], certifications: [], skills: [], careerContexts: [], ...overrides,
  } as unknown as CareerLibraryQuery
}

const assessment = (kind: string, recordId: string, color: string, extra: Record<string, unknown> = {}) => ({ kind, recordId, color, stale: false, ...extra })
const withExperience = (assessments: SectionReview['assessments'], aiTaskStatus?: string): ReviewsBySection => ({ ...noReviews, experience: { assessments, aiTaskStatus } })

it('counts every reviewable detail and asks for a review when none exist', () => {
  const health = libraryHealth(libraryWith(), noReviews)
  expect(health).toMatchObject({ total: 3, unreviewed: 3, good: 0 })
  expect(health.step).toMatchObject({ label: 'Review your library', signal: 'action', detail: '3 details have no current review.' })
})

it('sorts details into good, could improve, and needs work, and treats out-of-date reviews as unreviewed', () => {
  const health = libraryHealth(libraryWith(), withExperience([
    assessment('experience', 'e1', 'green'),
    assessment('experience_highlight', 'h1', 'yellow'),
    assessment('experience_highlight', 'h2', 'red', { stale: true }),
    assessment('experience_highlight', 'gone', 'red'),
  ]))
  expect(health).toMatchObject({ total: 3, good: 1, improvable: 1, weak: 0, unreviewed: 1 })
})

it('puts review questions first, then weak details', () => {
  const asked = withExperience([assessment('experience', 'e1', 'red', { question: 'How much?', reviewTaskId: 't1' }), assessment('experience_highlight', 'h1', 'green'), assessment('experience_highlight', 'h2', 'green')])
  expect(libraryHealth(libraryWith(), asked).step).toMatchObject({ label: 'Answer review questions', detail: '1 detail has a question for you.' })
  const weak = withExperience([assessment('experience', 'e1', 'red'), assessment('experience_highlight', 'h1', 'green'), assessment('experience_highlight', 'h2', 'green')])
  expect(libraryHealth(libraryWith(), weak).step).toMatchObject({ label: 'Improve weak details', detail: '1 detail needs work.' })
})

it('shows the AI working while a section review runs', () => {
  expect(libraryHealth(libraryWith(), withExperience([], 'QUEUED')).step).toMatchObject({ label: 'Reviewing your library', signal: 'ai' })
})

it('is done only when every detail is reviewed and good; could-improve-only has no signal', () => {
  const good = withExperience([assessment('experience', 'e1', 'green'), assessment('experience_highlight', 'h1', 'green'), assessment('experience_highlight', 'h2', 'green')])
  expect(libraryHealth(libraryWith(), good).step).toMatchObject({ label: 'Looking good', signal: 'done' })
  const polish = withExperience([assessment('experience', 'e1', 'yellow'), assessment('experience_highlight', 'h1', 'green'), assessment('experience_highlight', 'h2', 'green')])
  expect(libraryHealth(libraryWith(), polish).step).toMatchObject({ label: 'Polish what’s left', signal: null })
})

it('asks for role details when there is nothing reviewable, such as a skills-only library', () => {
  const health = libraryHealth(libraryWith({ experiences: [], skills: [{ id: 's', name: 'Ruby', category: null, position: 1 }] } as never), noReviews)
  expect(health).toMatchObject({ total: 0 })
  expect(health.step.label).toBe('Add role details')
})
