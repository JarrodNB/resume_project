/**
 * Description: Short human-readable labels for career library entries, used in action menus and
 * dialogs. Dates are included so look-alike duplicates can be told apart.
 * Index:
 *   - experienceLabel, projectLabel, educationLabel
 */
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { formatDateRange } from '@/lib/formatDateRange'

type Experience = CareerLibraryQuery['experiences'][number]
type Project = CareerLibraryQuery['projects'][number]
type Education = CareerLibraryQuery['educations'][number]

/** Joins a label with its date range, when there is one. */
function withDates(label: string, dates: string) {
  return dates ? `${label} (${dates})` : label
}

/** "Engineer at Acme (Mar 2021 – Present)". */
export function experienceLabel(experience: Experience) {
  const dates = formatDateRange(experience.startDate, experience.endDate, { openEndedMeansPresent: true })
  return withDates(`${experience.title} at ${experience.company}`, dates)
}

/** "Side project (Jan 2023)". */
export function projectLabel(project: Project) {
  return withDates(project.name, formatDateRange(project.startDate, project.endDate))
}

/** "State University, BSc (Sep 2015 – Jun 2019)". */
export function educationLabel(education: Education) {
  const name = [education.institution, education.degree].filter(Boolean).join(', ')
  return withDates(name, formatDateRange(education.startDate, education.endDate))
}
