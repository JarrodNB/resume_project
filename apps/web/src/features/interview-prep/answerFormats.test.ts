/** Independent answer drafts retain text without converting between story formats. */
import { expect, it } from 'vitest'
import { normalizeAnswerDrafts, projectAnswer } from './answerFormats'

it('keeps legacy text in Plain text and projects only populated active fields', () => {
  const drafts = normalizeAnswerDrafts(undefined, 'Existing answer')
  drafts.car.context = 'A busy team'
  drafts.car.action = 'I paired with a teammate'
  expect(projectAnswer('plain_text', drafts)).toBe('Existing answer')
  expect(projectAnswer('car', drafts)).toBe('Context: A busy team\n\nAction: I paired with a teammate')
  expect(projectAnswer('star', drafts)).toBe('')
})
