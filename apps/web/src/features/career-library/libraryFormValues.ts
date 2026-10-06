/**
 * Description: Values prepared by the career library forms before they are sent.
 * Index:
 *   - blankToNull: trims a string and returns null when nothing is left
 *   - highlightsToSave: bullets to send, or undefined when they match the saved list
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
