/**
 * Description: Explicit issue and expiry labels for certification dates.
 * Index:
 *   - formatCertificationDates: known dates with their meanings
 */
import { formatMonthYear } from './formatDateRange'

const FULL_DATE = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

/** Formats each known date without implying a missing expiry means the credential expires. */
export function formatCertificationDates(issued?: string | null, expiry?: string | null): string {
  return [issued ? `Issued ${formatCertificationDate(issued)}` : '', expiry ? `Expires ${formatCertificationDate(expiry)}` : ''].filter(Boolean).join(' · ')
}

/** Retains exact days for full dates and original precision for year/month dates. */
function formatCertificationDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00Z`)
    return Number.isNaN(date.getTime()) ? value : FULL_DATE.format(date)
  }
  return formatMonthYear(value)
}
