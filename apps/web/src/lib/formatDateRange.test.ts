/**
 * Description: Tests for date range formatting.
 */
import { expect, it } from 'vitest'
import { formatDateRange } from './formatDateRange'

it('formats closed and open-ended ranges', () => {
  expect(formatDateRange('2019-01-01', '2021-06-01')).toBe('Jan 2019 – Jun 2021')
  expect(formatDateRange('2021-03-01', null, { openEndedMeansPresent: true })).toBe('Mar 2021 – Present')
  expect(formatDateRange('2021-03-01', null)).toBe('Mar 2021')
  expect(formatDateRange(null, null, { openEndedMeansPresent: true })).toBe('')
})
