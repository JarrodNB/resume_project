/**
 * Preserve certification date precision while editing API dates. Validate the user's calendar
 * date before GraphQL coercion, which would otherwise surface as a generic request error.
 * Index:
 *   - editableCertificationDate: API date and precision to user-entered date
 *   - certificationDateAttributes: user-entered partial or full date to API attributes
 */

/** Restores the supplied year/month/day precision; legacy dates default to full dates. */
export function editableCertificationDate(value: string | null | undefined, precision?: string | null): string {
  if (!value) return ''
  return precision === 'year' ? value.slice(0, 4) : precision === 'month' ? value.slice(0, 7) : value
}

/** Normalizes a valid partial date without inventing its original precision. */
export function certificationDateAttributes(value: string): { date: string | null; precision: string | null } {
  const trimmed = value.trim()
  if (!trimmed) return { date: null, precision: 'day' }
  if (/^\d{4}$/.test(trimmed)) return { date: `${trimmed}-01-01`, precision: 'year' }
  if (/^\d{4}-\d{2}$/.test(trimmed)) return { date: `${trimmed}-01`, precision: 'month' }
  return { date: trimmed, precision: 'day' }
}


/** Rejects malformed and impossible calendar dates before GraphQL date coercion. */
export function certificationDateError(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(trimmed)
  const formatError = 'Enter a year (2024), month (2024-06), or full date (2024-06-15).'
  if (!match) return formatError
  const year = Number(match[1])
  const month = Number(match[2] ?? 1)
  const day = Number(match[3] ?? 1)
  if (year < 1 || month < 1 || month > 12 || day < 1) return 'Enter a valid calendar date.'
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  return day > daysInMonth ? 'Enter a valid calendar date.' : null
}
