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
  expect(formatDateRange('2025-01', '2026-09')).toBe('Jan 2025 – Sep 2026')
})

it('shows an impossible month as typed instead of throwing', () => {
  expect(formatDateRange('2021-13', '2021-00')).toBe('2021-13 – 2021-00')
  expect(formatDateRange('2021-13', null, { openEndedMeansPresent: true })).toBe('2021-13 – Present')
})
