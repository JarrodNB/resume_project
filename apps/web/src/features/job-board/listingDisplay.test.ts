import { expect, it } from 'vitest'
import { formatPostedDate, formatSalary, stripRecruiterTags } from './listingDisplay'

it('preserves hourly cents and decimal ranges', () => {
  expect(formatSalary('$17.50 per hour', 'USD')).toBe('$17.50 / hour')
  expect(formatSalary('$17.50 - $22.75 hourly', 'USD')).toBe('$17.50 – $22.75 / hour')
  expect(formatSalary('80.123k per year', 'USD')).toBe('$80,123 / year')
})

it.each([
  'Up to $150,000 per year',
  'From $60 per hour',
  '$120k+ per year',
  '$60 per hour + 10% bonus',
  '$120k base, $150k OTE',
])('preserves salary qualifications in %s', (salary) => {
  expect(formatSalary(salary, 'USD')).toBe(`${salary} · USD`)
})

it('shows pay in one format with the currency named once', () => {
  expect(formatSalary('$103,000 - $171,000 USD', 'USD')).toBe('$103,000 – $171,000')
  expect(formatSalary('120,000 per year', 'USD')).toBe('$120,000 / year')
  expect(formatSalary('$60 per hour', 'USD')).toBe('$60 / hour')
  expect(formatSalary('80k-100k', null)).toBe('$80,000 – $100,000')
  expect(formatSalary('Competitive USD', 'USD')).toBe('Competitive · USD')
  expect(formatSalary(null, 'USD')).toBeNull()
})

it('uses relative posting dates and an unambiguous fallback', () => {
  const now = new Date(2026, 10, 5, 15)
  expect(formatPostedDate(new Date(2026, 10, 5, 1), now)).toBe('Today')
  expect(formatPostedDate(new Date(2026, 10, 4, 23), now)).toBe('Yesterday')
  expect(formatPostedDate(new Date(2026, 10, 2), now)).toBe('3 days ago')
  expect(formatPostedDate(new Date(2026, 9, 5), now)).toBe('Oct 5, 2026')
})

it('removes recruiter tags from descriptions', () => {
  expect(stripRecruiterTags('Great role.\n\n#LI-DNI\n\n\n\nApply now #LI-Remote')).toBe('Great role.\n\nApply now')
})
