/**
 * Description: Certification rendering preserves each supplied date's precision.
 * Index:
 *   - certification date precision regression
 */
import { expect, it } from 'vitest'
import { formatCertificationDates } from './formatCertificationDates'

it('preserves full expiry days, months, and years', () => {
  expect(formatCertificationDates('2024', '2026-10-31')).toBe('Issued 2024 · Expires Oct 31, 2026')
  expect(formatCertificationDates('2024-06', '2026')).toBe('Issued Jun 2024 · Expires 2026')
  expect(formatCertificationDates(null, '2026-10')).toBe('Expires Oct 2026')
})
