/**
 * Description: Whether a role edit should send its bullets. An unchanged list is omitted so the
 * saved highlight ids stay put.
 */
import { expect, it } from 'vitest'
import { highlightsToSave } from './libraryFormValues'

it('omits highlights that still match the saved bullets', () => {
  expect(highlightsToSave(['Built it', ''], ['Built it'])).toBeUndefined()
})

it('sends the bullets when one was added, removed, or rewritten', () => {
  expect(highlightsToSave(['Built it', 'Scaled it'], ['Built it'])).toEqual(['Built it', 'Scaled it'])
  expect(highlightsToSave([''], ['Built it'])).toEqual([])
  expect(highlightsToSave(['Scaled it'], null)).toEqual(['Scaled it'])
})
