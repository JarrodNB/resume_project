/**
 * Description: Tests for the remembered open-section list.
 */
import { expect, it } from 'vitest'
import { isSectionOpen, OPEN_SECTIONS_STORAGE_KEY, setSectionOpen } from './openSections'

it('starts collapsed', () => {
  expect(isSectionOpen('library.experience')).toBe(false)
})

it('keeps a section open for a later read, and drops it when collapsed', () => {
  setSectionOpen('library.experience', true)
  setSectionOpen('library.skills', true)

  expect(isSectionOpen('library.experience')).toBe(true)
  expect(JSON.parse(localStorage.getItem(OPEN_SECTIONS_STORAGE_KEY) ?? '[]')).toEqual(['library.experience', 'library.skills'])

  setSectionOpen('library.experience', false)

  expect(isSectionOpen('library.experience')).toBe(false)
  expect(isSectionOpen('library.skills')).toBe(true)
})

it('treats stored data that is not a list of strings as nothing open', () => {
  localStorage.setItem(OPEN_SECTIONS_STORAGE_KEY, '{')
  expect(isSectionOpen('library.experience')).toBe(false)

  localStorage.setItem(OPEN_SECTIONS_STORAGE_KEY, '{"open":true}')
  expect(isSectionOpen('library.experience')).toBe(false)

  localStorage.setItem(OPEN_SECTIONS_STORAGE_KEY, '[1, null]')
  expect(isSectionOpen('library.experience')).toBe(false)
})
