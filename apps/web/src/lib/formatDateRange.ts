/**
 * Description: Formats ISO dates from the API ("2021-03-01") as short month-year ranges.
 * Index:
 *   - formatMonthYear: "2021-03-01" -> "Mar 2021"
 *   - formatDateRange: "Mar 2021 – Present", "2019 – 2021"-style ranges
 */

const MONTH_YEAR = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' })

/** Formats an ISO date as "Mon YYYY" (UTC, so the day never shifts the month). */
export function formatMonthYear(isoDate: string): string {
  return MONTH_YEAR.format(new Date(`${isoDate.slice(0, 10)}T00:00:00Z`))
}

/**
 * Formats a start/end pair. A missing end shows "Present" when `openEndedMeansPresent` (current
 * roles); otherwise only the known side is shown. Returns an empty string when both are missing.
 */
export function formatDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  { openEndedMeansPresent = false } = {},
): string {
  const start = startDate ? formatMonthYear(startDate) : null
  const end = endDate ? formatMonthYear(endDate) : openEndedMeansPresent && start ? 'Present' : null
  return [start, end].filter(Boolean).join(' – ')
}
