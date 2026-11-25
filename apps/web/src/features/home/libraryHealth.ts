/** Sums up how healthy the career library is, from the AI section reviews already saved.
 *
 * Every reviewable detail (summary, role descriptions and highlights, project descriptions, saved
 * career-context answers) is in one of five states: looks good, could improve, needs work, not
 * reviewed yet, or review out of date. Reviews that no longer match a current detail are ignored.
 * Reading saved reviews never starts model work; this file only counts and picks the next step.
 */
import { hasOpenQuestion, libraryReviewTargets, REVIEW_SECTIONS, type ReviewSection } from '@/features/career-library/libraryReviewTargets'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import type { Signal } from './nextSteps'

export interface SectionReview {
  aiTaskStatus?: string | null
  assessments: { kind: string; recordId: string; color: string; question?: string | null; reviewTaskId?: string | null; stale: boolean }[]
}

export type ReviewsBySection = Record<ReviewSection, SectionReview>
export const REVIEW_SECTION_KEYS = Object.keys(REVIEW_SECTIONS) as ReviewSection[]

export interface LibraryHealth {
  total: number
  good: number
  improvable: number
  weak: number
  /** Details with no review, or whose last review is out of date. */
  unreviewed: number
  /** Details whose current review has a question waiting for the user. */
  questions: number
  reviewing: boolean
  step: { label: string; detail: string; signal: Signal | null }
}

export function libraryHealth(library: CareerLibraryQuery, reviews: ReviewsBySection): LibraryHealth {
  const health = { total: 0, good: 0, improvable: 0, weak: 0, unreviewed: 0, questions: 0 }
  for (const target of libraryReviewTargets(library)) {
    health.total += 1
    const current = reviews[target.section].assessments.filter((item) => item.kind === target.kind && item.recordId === target.recordId && !item.stale)
    if (current.length === 0) { health.unreviewed += 1; continue }
    if (current.some(hasOpenQuestion)) health.questions += 1
    const colors = current.map((item) => item.color)
    if (colors.includes('red')) health.weak += 1
    else if (colors.includes('yellow')) health.improvable += 1
    else health.good += 1
  }
  const reviewing = REVIEW_SECTION_KEYS.some((section) => reviews[section].aiTaskStatus === 'QUEUED')
  return { ...health, reviewing, step: nextStep({ ...health, reviewing }) }
}

function nextStep(h: Omit<LibraryHealth, 'step'>): LibraryHealth['step'] {
  if (h.total === 0) return { label: 'Add role details', detail: 'Roles and projects with details can be reviewed.', signal: 'action' }
  if (h.reviewing) return { label: 'Reviewing your library', detail: 'The AI is reading your sections.', signal: 'ai' }
  if (h.questions > 0) return { label: 'Answer review questions', detail: h.questions === 1 ? '1 detail has a question for you.' : `${h.questions} details have questions for you.`, signal: 'action' }
  if (h.weak > 0) return { label: 'Improve weak details', detail: h.weak === 1 ? '1 detail needs work.' : `${h.weak} details need work.`, signal: 'action' }
  if (h.unreviewed > 0) return { label: 'Review your library', detail: h.unreviewed === 1 ? '1 detail has no current review.' : `${h.unreviewed} details have no current review.`, signal: 'action' }
  if (h.improvable > 0) return { label: 'Polish what’s left', detail: h.improvable === 1 ? '1 detail could improve.' : `${h.improvable} details could improve.`, signal: null }
  return { label: 'Looking good', detail: 'Every reviewed detail looks good.', signal: 'done' }
}
