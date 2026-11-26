/** Independent answer drafts retain text without converting between story formats. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { isBlankAnswer, normalizeAnswerDrafts, normalizeAnswerForComparison, projectAnswer, type AnswerFormat } from './answerFormats'
import { questionProgress } from './questionProgress'

// Shared with Rails (ActiveAnswer) and the Python chat reader.
const cases: {
  answers: { name: string; format: AnswerFormat; drafts: Record<string, Record<string, string>>; text: string; answered: boolean }[]
  same_answer_pairs: { name: string; a: string; b: string; same: boolean }[]
} = JSON.parse(readFileSync(resolve(process.cwd(), '../../services/ai/tests/fixtures/active_answer_cases.json'), 'utf8'))

it.each(cases.answers)('projects and counts the active answer like Rails: $name', ({ format, drafts, text, answered }) => {
  expect(projectAnswer(format, normalizeAnswerDrafts(drafts))).toBe(text)
  expect(!isBlankAnswer(text)).toBe(answered)
})

it.each(cases.same_answer_pairs)('compares answers for freshness like Rails: $name', ({ a, b, same }) => {
  expect(normalizeAnswerForComparison(a) === normalizeAnswerForComparison(b)).toBe(same)
})

it('shows the progress the server decided', () => {
  expect(questionProgress({ progress: 'UNANSWERED' })).toBe('unanswered')
  expect(questionProgress({ progress: 'OUTDATED' })).toBe('outdated')
})

it('keeps legacy text in Plain text and projects only populated active fields', () => {
  const drafts = normalizeAnswerDrafts(undefined, 'Existing answer')
  drafts.car.context = 'A busy team'
  drafts.car.action = 'I paired with a teammate'
  expect(projectAnswer('plain_text', drafts)).toBe('Existing answer')
  expect(projectAnswer('car', drafts)).toBe('Context: A busy team\n\nAction: I paired with a teammate')
  expect(projectAnswer('star', drafts)).toBe('')
})
