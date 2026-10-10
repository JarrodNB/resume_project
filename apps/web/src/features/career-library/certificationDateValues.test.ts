/**
 * Description: Certification dates retain imported precision and accept legacy full dates.
 * Index:
 *   - date round-trip tests
 */
import { expect, it } from 'vitest'
import { certificationDateAttributes, editableCertificationDate } from './certificationDateValues'

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
