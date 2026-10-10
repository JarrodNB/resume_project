/**
 * Description: Explicit issue and expiry labels for certification dates.
 * Index:
 *   - formatCertificationDates: known dates with their meanings
 */
import { formatMonthYear } from './formatDateRange'

/** Formats each known date without implying a missing expiry means the credential expires. */
export function formatCertificationDates(issued?: string | null, expiry?: string | null): string {
  return [issued ? `Issued ${formatMonthYear(issued)}` : '', expiry ? `Expires ${formatMonthYear(expiry)}` : ''].filter(Boolean).join(' · ')
}
