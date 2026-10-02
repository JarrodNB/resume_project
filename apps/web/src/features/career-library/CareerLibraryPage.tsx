/**
 * Description: Career library page: everything known about the user's career (the source of truth
 * for tailoring), plus their resumes.
 * Index:
 *   - CareerLibraryPage: page component
 */
import { FileUp } from 'lucide-react'
import { Link } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { formatDateRange } from '@/lib/formatDateRange'
import { LibraryEntry } from './LibraryEntry'
import { LibrarySection } from './LibrarySection'
import { ResumeList } from './ResumeList'
import { SkillList } from './SkillList'
import { useCareerLibrary } from './useCareerLibrary'

/** Shows resumes, experiences, projects, education, and skills. */
export function CareerLibraryPage() {
  const { library, loading, error } = useCareerLibrary()

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
      {error && <ErrorAlert title="Couldn't load your library" messages={[requestErrorMessage(error, error.message)]} />}
      {!library && loading && <p className="text-muted-foreground">Loading…</p>}
      {library && (
        <>
          <LibrarySection title="Resumes" count={library.resumes.length} emptyText="Import a resume to create your base resume.">
            <ResumeList resumes={library.resumes} />
          </LibrarySection>
          <LibrarySection title="Experience" count={library.experiences.length} emptyText="No roles yet.">
            {library.experiences.map((experience) => (
              <LibraryEntry
                key={experience.id}
                heading={experience.title}
                subheading={[experience.company, experience.location].filter(Boolean).join(' · ')}
                dates={formatDateRange(experience.startDate, experience.endDate, { openEndedMeansPresent: true })}
                description={experience.description}
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
            {library.projects.map((project) => (
              <LibraryEntry
                key={project.id}
                heading={project.name}
                subheading={[project.role, project.url].filter(Boolean).join(' · ')}
                dates={formatDateRange(project.startDate, project.endDate)}
                description={project.description}
              />
            ))}
          </LibrarySection>
          <LibrarySection title="Education" count={library.educations.length} emptyText="No education yet.">
            {library.educations.map((education) => (
              <LibraryEntry
                key={education.id}
                heading={education.institution}
                subheading={[education.degree, education.fieldOfStudy].filter(Boolean).join(', ')}
                dates={formatDateRange(education.startDate, education.endDate)}
                description={education.description}
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
