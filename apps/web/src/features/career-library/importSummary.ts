/**
 * Description: The counts an import reports (AiTask result.import_summary) and the router state
 * that carries them from the import page to the career library.
 * Index:
 *   - ImportSummary: entries added and entries merged into existing ones
 *   - readImportSummary: pulls a valid summary out of an AiTask result, or null
 *   - importSummaryFromLocationState: reads the summary passed through navigation state, or null
 *   - describeImportSummary: "2 entries added, 3 merged into existing entries."
 */

export interface ImportSummary {
  added: number
  merged: number
}

/** Returns true for an object with numeric `added` and `merged`. */
function isImportSummary(value: unknown): value is ImportSummary {
  if (typeof value !== 'object' || value === null) return false
  const { added, merged } = value as Record<string, unknown>
  return typeof added === 'number' && typeof merged === 'number'
}

/** Reads `import_summary` from an AiTask's JSON result. */
export function readImportSummary(result: unknown): ImportSummary | null {
  if (typeof result !== 'object' || result === null) return null
  const summary = (result as Record<string, unknown>).import_summary
  return isImportSummary(summary) ? summary : null
}

/** Reads `{ importSummary }` from react-router location state. */
export function importSummaryFromLocationState(state: unknown): ImportSummary | null {
  if (typeof state !== 'object' || state === null) return null
  const summary = (state as Record<string, unknown>).importSummary
  return isImportSummary(summary) ? summary : null
}

/** Pluralizes "entry" for a count. */
function entries(count: number) {
  return `${count} ${count === 1 ? 'entry' : 'entries'}`
}

/** Describes the counts in one sentence. */
export function describeImportSummary({ added, merged }: ImportSummary) {
  return `${entries(added)} added, ${merged} merged into existing entries.`
}
