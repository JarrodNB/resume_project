/**
 * Description: Preserve certification date precision while editing API dates.
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
