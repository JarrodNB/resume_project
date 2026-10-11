/**
 * Description: Locale-aware creation dates for interview sets.
 * Index: interviewSetDate
 */
/** Formats the set creation date in the browser's locale and timezone. */
export function interviewSetDate(date: string) {
  return new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

