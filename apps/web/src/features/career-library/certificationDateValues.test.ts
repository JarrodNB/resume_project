/**
 * Description: Certification dates retain imported precision and accept legacy full dates.
 * Index:
 *   - date round-trip tests
 */
import { expect, it } from 'vitest'
import { certificationDateAttributes, editableCertificationDate, certificationDateError } from './certificationDateValues'

it.each([
  ['2027-01-01', 'year', '2027'],
  ['2027-06-01', 'month', '2027-06'],
  ['2027-06-12', 'day', '2027-06-12'],
])('preserves %s at %s precision on edit and save', (date, precision, display) => {
  expect(editableCertificationDate(date, precision)).toBe(display)
  expect(certificationDateAttributes(display)).toEqual({ date, precision })
})

it('keeps full dates without metadata and clears dates with their precision', () => {
  expect(editableCertificationDate('2027-06-12')).toBe('2027-06-12')
  expect(certificationDateAttributes('')).toEqual({ date: null, precision: 'day' })
})

it.each(['last year', '2024-1', '2024-13', '2023-02-29', '2024-04-31', '0000', '2024-00', '2024-01-00'])('rejects invalid date %s', value => {
  expect(certificationDateError(value)).not.toBeNull()
})

it.each(['', '  ', '2024', '2024-06', '2024-02-29', '2000-02-29', '2024-06-15'])('accepts valid optional/partial date %s', value => {
  expect(certificationDateError(value)).toBeNull()
})
