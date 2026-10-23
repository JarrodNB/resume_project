/**
 * Description: Short human-readable labels for career library entries, used in action menus and
 * dialogs. Dates are included so look-alike duplicates can be told apart.
 * Index:
 *   - experienceLabel, projectLabel, educationLabel, certificationLabel
 */
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { editableCertificationDate } from './certificationDateValues'
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
  return `${experience.roles.map((role) => withDates(role.title, formatDateRange(role.startDate, role.endDate, { openEndedMeansPresent: true }))).join('; ')} at ${experience.company}`
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

/** A certification label, including its issuer to distinguish duplicate names. */
export function certificationLabel(certification: CareerLibraryQuery['certifications'][number]) {
  return withDates([certification.name, certification.issuer].filter(Boolean).join(', '), formatDateRange(editableCertificationDate(certification.issuedDate, certification.issuedDatePrecision), editableCertificationDate(certification.expiryDate, certification.expiryDatePrecision)))
}
