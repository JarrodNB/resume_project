/**
 * Description: Career library page: everything known about the user's career (the source of truth
 * for tailoring), starting with their profile. Entries can be deleted or merged into duplicates.
 * Index:
 *   - CareerLibraryPage: page component
 */
import { FileUp } from 'lucide-react'
import { Link } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { formatDateRange } from '@/lib/formatDateRange'
import { ImportSummaryNotice } from './ImportSummaryNotice'
import { LibraryEntry } from './LibraryEntry'
import { LibraryEntryActions } from './LibraryEntryActions'
import { LibrarySection } from './LibrarySection'
import { educationLabel, experienceLabel, projectLabel } from './libraryEntryLabels'
import type { MergeCandidate } from './MergeEntryDialog'
import { ProfileSection } from './ProfileSection'
import { SkillList } from './SkillList'
import type { MergeableEntryKind } from './useLibraryEntryActions'
import { useCareerLibrary } from './useCareerLibrary'

/** Builds the actions menu for one entry; any other entry in its section is a merge target. */
function entryActions(kind: MergeableEntryKind, entries: MergeCandidate[], entry: MergeCandidate) {
  return (
    <LibraryEntryActions
      kind={kind}
      entryId={entry.id}
      entryLabel={entry.label}
      mergeCandidates={entries.filter((candidate) => candidate.id !== entry.id)}
    />
  )
}

/** Shows the profile, experiences, projects, education, and skills. */
export function CareerLibraryPage() {
  const { library, loading, error } = useCareerLibrary()
  const experiences = library?.experiences.map((experience) => ({ id: experience.id, label: experienceLabel(experience) })) ?? []
  const projects = library?.projects.map((project) => ({ id: project.id, label: projectLabel(project) })) ?? []
  const educations = library?.educations.map((education) => ({ id: education.id, label: educationLabel(education) })) ?? []

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Career library</h1>
          <p className="text-muted-foreground">Everything your tailored resumes are built from.</p>
        </div>
        <Button asChild>
          <Link to="/import">
            <FileUp /> Import a resume
          </Link>
        </Button>
      </div>
      <ImportSummaryNotice />
      {error && <ErrorAlert title="Couldn't load your library" messages={[requestErrorMessage(error, error.message)]} />}
      {!library && loading && <p className="text-muted-foreground">Loading…</p>}
      {library && (
        <>
          <ProfileSection profile={library.me} />
          <LibrarySection title="Experience" count={library.experiences.length} emptyText="No roles yet.">
            {library.experiences.map((experience, index) => (
              <LibraryEntry
                key={experience.id}
                heading={experience.title}
                subheading={[experience.company, experience.location].filter(Boolean).join(' · ')}
                dates={formatDateRange(experience.startDate, experience.endDate, { openEndedMeansPresent: true })}
                description={experience.description}
                actions={entryActions('experience', experiences, experiences[index])}
              >
                {experience.highlights.length > 0 && (
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                    {experience.highlights.map((highlight) => (
                      <li key={highlight.id}>{highlight.content}</li>
                    ))}
                  </ul>
                )}
              </LibraryEntry>
            ))}
          </LibrarySection>
          <LibrarySection title="Projects" count={library.projects.length} emptyText="No projects yet.">
            {library.projects.map((project, index) => (
              <LibraryEntry
                key={project.id}
                heading={project.name}
                subheading={[project.role, project.url].filter(Boolean).join(' · ')}
                dates={formatDateRange(project.startDate, project.endDate)}
                description={project.description}
                actions={entryActions('project', projects, projects[index])}
              />
            ))}
          </LibrarySection>
          <LibrarySection title="Education" count={library.educations.length} emptyText="No education yet.">
            {library.educations.map((education, index) => (
              <LibraryEntry
                key={education.id}
                heading={education.institution}
                subheading={[education.degree, education.fieldOfStudy].filter(Boolean).join(', ')}
                dates={formatDateRange(education.startDate, education.endDate)}
                description={education.description}
                actions={entryActions('education', educations, educations[index])}
              />
            ))}
          </LibrarySection>
          <LibrarySection title="Skills" count={library.skills.length} emptyText="No skills yet.">
            <SkillList skills={library.skills} />
          </LibrarySection>
        </>
      )}
    </div>
  )
}
