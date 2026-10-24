/** Read the completed Markdown document and omission warnings from a tailoring task. */

/** Warnings on a finished draft. */
export function warningsFromResult(result: unknown): string[] {
  return isRecord(result) ? stringList(result.warnings) : []
}

/** Only a new-format task can provide an editable resume. */
export function markdownFromResult(result: unknown): string {
  return isRecord(result) && typeof result.markdown === 'string' ? result.markdown : ''
}

/** String entries of a list. */
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** True for a JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
