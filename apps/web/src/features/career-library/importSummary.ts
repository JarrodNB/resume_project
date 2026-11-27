/**
 * Description: The counts an import reports (AiTask result.import_summary) and the router state
 * that carries them from the import page to the career library.
 * Index:
 *   - ImportSummary: entries added and merged, plus what was added per section (skills included)
 *   - readImportSummary: pulls a valid summary out of an AiTask result, or null
 *   - importSummaryFromLocationState: reads the summary passed through navigation state, or null
 *   - describeImportSummary: "Added 2 roles, 1 education entry and 5 skills."
 */

/** Library sections Rails counts in `added_by_section`, in the order the sentence lists them. */
const SECTION_WORDS = {
  experiences: ['role', 'roles'],
  projects: ['project', 'projects'],
  educations: ['education entry', 'education entries'],
  certifications: ['certification', 'certifications'],
  skills: ['skill', 'skills'],
} as const

type SummarySection = keyof typeof SECTION_WORDS

export interface ImportSummary {
  /** Roles, projects, education and certifications added (skills are not counted here). */
  added: number
  /** Roles, projects, education and certifications merged into entries the library already had. */
  merged: number
  /** What was added, per section. Imports saved before this was recorded leave it out. */
  added_by_section?: Partial<Record<SummarySection, number>>
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

function counted(count: number, [one, many]: readonly [string, string]) {
  return `${count} ${count === 1 ? one : many}`
}

/** "a", "a and b", "a, b and c". */
function listInWords(parts: string[]) {
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** Describes what the import added and merged in plain words, leaving out zero counts. */
export function describeImportSummary({ added, merged, added_by_section: bySection }: ImportSummary) {
  const addedParts = bySection
    ? (Object.keys(SECTION_WORDS) as SummarySection[])
      .filter((section) => (bySection[section] ?? 0) > 0)
      .map((section) => counted(bySection[section] ?? 0, SECTION_WORDS[section]))
    : added > 0 ? [counted(added, ['entry', 'entries'])] : []
  const sentences = []
  if (addedParts.length > 0) sentences.push(`Added ${listInWords(addedParts)}.`)
  if (merged > 0) {
    sentences.push(merged === 1
      ? '1 entry matched one you already had, so it was merged into it.'
      : `${merged} entries matched ones you already had, so they were merged into them.`)
  }
  return sentences.length > 0 ? sentences.join(' ') : 'Nothing new was added. Your library already had everything in this resume.'
}
