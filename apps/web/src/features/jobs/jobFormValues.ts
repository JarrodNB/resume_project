/**
 * Description: Values prepared by the job form before they are sent.
 * Index:
 *   - JobDraft: the fields the form reads from a saved job
 *   - blankToNull: trims a string and returns null when nothing is left
 *   - jobAttributes: the JobAttributesInput sent on create and update
 */

export interface JobDraft {
  id: string
  title: string
  company: string
  location: string | null
  url: string | null
  notes: string | null
  description: string | null
  requirements: string[]
  responsibilities: string[]
  niceToHaves: string[]
}

/** Trims a string and returns null when nothing is left, so a cleared field is stored as null. */
export function blankToNull(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

interface JobFormFields {
  title: string
  company: string
  location: string
  url: string
  notes: string
  description: string
  requirements: string[]
  responsibilities: string[]
  niceToHaves: string[]
}

/** Builds the attributes sent for every field. Blank lines are dropped from the lists. */
export function jobAttributes(values: JobFormFields) {
  const lines = (items: string[]) => items.map((item) => item.trim()).filter(Boolean)
  return {
    title: values.title.trim(),
    company: values.company.trim(),
    location: blankToNull(values.location),
    url: blankToNull(values.url),
    notes: blankToNull(values.notes),
    description: blankToNull(values.description),
    requirements: lines(values.requirements),
    responsibilities: lines(values.responsibilities),
    niceToHaves: lines(values.niceToHaves),
  }
}
