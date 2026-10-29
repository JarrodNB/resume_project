/**
 * Description: Tests for the page-number list and the readable search summary on the job board.
 */
import { expect, it } from 'vitest'
import { describeSearch, pagerItems } from './searchFilters'

it('lists every page when there are few', () => {
  expect(pagerItems(0, 1)).toEqual([0])
  expect(pagerItems(1, 3)).toEqual([0, 1, 2])
})

it('shows no pages when there are no results', () => {
  expect(pagerItems(0, 0)).toEqual([])
})

it('keeps first, last and neighbors, with a gap marker between distant pages', () => {
  expect(pagerItems(0, 10)).toEqual([0, 1, null, 9])
  expect(pagerItems(5, 10)).toEqual([0, null, 4, 5, 6, null, 9])
  expect(pagerItems(9, 10)).toEqual([0, null, 8, 9])
})

it('does not add a gap marker when pages are only one apart', () => {
  expect(pagerItems(2, 6)).toEqual([0, 1, 2, 3, null, 5])
})

it('summarizes a keyword-only search', () => {
  expect(describeSearch({ keyword: 'designer', remoteOnly: false, experienceLevels: [] }))
    .toBe('For “designer” · All experience levels · Newest')
})

it('summarizes remote, experience, pay and sort choices', () => {
  expect(describeSearch({
    keyword: 'engineer',
    remoteOnly: true,
    experienceLevels: ['SE', 'MI'],
    locationLabel: 'Denver',
    filters: { maxAge: '7d', minimumSalary: 90000, includeUndisclosedSalaries: false, sortBy: 'relevance' },
  })).toBe('For “engineer” · Denver · Any remote option · Past 7 days · Mid level, Senior · Minimum pay: 90,000 (disclosed only) · Most relevant')
})
