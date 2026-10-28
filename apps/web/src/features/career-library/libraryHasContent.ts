/** Tells whether the career library holds anything real yet.
 *
 * Used by Home and the Library page to decide whether to point a new user at importing a
 * resume. Profile details and career context alone do not count: the library is "started"
 * once there is at least one role, project, education, certification, or skill.
 */
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'

export function libraryHasContent(library: CareerLibraryQuery) {
  return library.experiences.length + library.projects.length + library.educations.length
    + library.certifications.length + library.skills.length > 0
}
