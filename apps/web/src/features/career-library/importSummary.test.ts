/** Checks that the import summary reads in plain words: per-section counts, skills included, no zero counts. */
import { expect, it } from 'vitest'
import { describeImportSummary } from './importSummary'

it('lists what was added by section, skills included, and leaves out zero counts', () => {
  expect(describeImportSummary({ added: 3, merged: 0, added_by_section: { experiences: 2, projects: 0, educations: 1, certifications: 0, skills: 5 } }))
    .toBe('Added 2 roles, 1 education entry and 5 skills.')
})

it('explains merges in words and handles a single section', () => {
  expect(describeImportSummary({ added: 1, merged: 2, added_by_section: { experiences: 1, skills: 0 } }))
    .toBe('Added 1 role. 2 entries matched ones you already had, so they were merged into them.')
})

it('falls back to the entry count for imports saved before per-section counts', () => {
  expect(describeImportSummary({ added: 2, merged: 0 })).toBe('Added 2 entries.')
})

it('says so when nothing new was added', () => {
  expect(describeImportSummary({ added: 0, merged: 0, added_by_section: { skills: 0 } }))
    .toBe('Nothing new was added. Your library already had everything in this resume.')
})
