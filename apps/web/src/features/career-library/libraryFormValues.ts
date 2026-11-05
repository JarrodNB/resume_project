/**
 * Description: Values prepared by the career library forms before they are sent.
 * Index:
 *   - blankToNull: trims a string and returns null when nothing is left
 *   - highlightsToSave: bullets to send, or undefined when they match the saved list
 *   - requiredFieldErrors: inline messages for required fields left blank
 *   - normalizeWebAddress: adds https:// to a pasted link, or explains why it is not a link
 */

/** Trims a string and returns null when nothing is left, so a cleared field is stored as null. */
export function blankToNull(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/** Drops blank bullets. Returns undefined when that list is the one already saved, so an update
 * can omit highlights and keep their ids. */
export function highlightsToSave(draft: string[], original: string[] | null) {
  const next = draft.map((line) => line.trim()).filter(Boolean)
  if (original && next.length === original.length && next.every((line, index) => line === original[index].trim())) {
    return undefined
  }
  return next
}

/** Returns a field-name to message map for each required value that is blank. */
export function requiredFieldErrors(fields: Record<string, { label: string; value: string }>) {
  const errors: Record<string, string> = {}
  for (const [name, { label, value }] of Object.entries(fields)) {
    if (!value.trim()) errors[name] = `${label} is required.`
  }
  return errors
}

/** Turns "example.com/me" into "https://example.com/me". Blank gives a null value; text that
 * cannot be a web address gives an error message to show beside the field. */
export function normalizeWebAddress(input: string): { value: string | null; error?: string } {
  const trimmed = input.trim()
  if (!trimmed) return { value: null }
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const { hostname, protocol } = new URL(candidate)
    if ((protocol === 'http:' || protocol === 'https:') && (hostname.includes('.') || hostname === 'localhost') && !/\s/.test(trimmed)) return { value: candidate }
  } catch {
    // fall through to the message below
  }
  return { value: null, error: 'Enter a web address like example.com/your-page.' }
}
