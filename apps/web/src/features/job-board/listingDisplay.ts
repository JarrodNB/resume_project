/** Turn raw provider listing fields into clean text for the results list.
 * Providers send messy salary strings, US-format dates and recruiter tags. These helpers
 * only change how things look; nothing here is saved or sent back to the server.
 */

const PERIODS: [RegExp, string][] = [
  [/\b(hour|hr|hourly)\b/i, 'hour'], [/\b(year|yr|annual|annum|yearly)\b|\/\s*y\b/i, 'year'],
  [/\b(month|monthly)\b/i, 'month'], [/\b(week|weekly)\b/i, 'week'], [/\b(day|daily)\b/i, 'day'],
]

/** Show pay as "$103,000 – $171,000 / year": one format, currency named once. */
export function formatSalary(text: string | null, currency: string | null): string | null {
  const raw = text?.trim()
  if (!raw) return null
  const code = (currency?.trim() || raw.match(/\b[A-Z]{3}\b/)?.[0] || 'USD').toUpperCase()
  const amounts = [...raw.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*([kK])?\b/g)]
    .map(([, digits, k]) => Number(digits.replace(/,/g, '')) * (k ? 1000 : 1))
    .filter(Number.isFinite)
  if (amounts.length === 0 || amounts.length > 2) return raw.replace(new RegExp(`\\s*[·,-]?\\s*\\b${code}\\b\\s*$`, 'i'), '').concat(` · ${code}`)
  let formatter: Intl.NumberFormat
  try { formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: code, maximumFractionDigits: 0, currencyDisplay: code === 'USD' ? 'symbol' : 'code' }) } catch { return raw }
  const period = PERIODS.find(([pattern]) => pattern.test(raw))?.[1]
  const range = [...new Set(amounts)].map((amount) => formatter.format(amount)).join(' – ')
  return period ? `${range} / ${period}` : range
}

/** "Today", "Yesterday", "3 days ago" for the past two weeks, otherwise "Nov 5, 2026". */
export function formatPostedDate(published: Date, now = new Date()): string {
  const day = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  const daysAgo = Math.round((day(now) - day(published)) / 86_400_000)
  if (daysAgo === 0) return 'Today'
  if (daysAgo === 1) return 'Yesterday'
  if (daysAgo > 1 && daysAgo < 14) return `${daysAgo} days ago`
  return published.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Drop recruiter markers such as "#LI-DNI" or "#LI-Remote" that providers leave in descriptions. */
export function stripRecruiterTags(description: string): string {
  return description.replace(/[ \t]*#LI-[A-Za-z0-9_-]+/g, '').replace(/\n{3,}/g, '\n\n').trim()
}
