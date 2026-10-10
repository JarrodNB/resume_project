/**
 * Description: Career library page: everything known about the user's career (the source of truth
 * for tailoring), starting with their profile. Roles, projects, and education are listed most
 * recent first (the API orders them by date). Entries can be added, edited, deleted, or merged;
 * highlights can be dragged to a new place or into another role, and skills within their category.
 * The whole library can be deleted so a new resume import starts fresh.
 * Index:
 *   - CareerLibraryPage: page component
 */
import { DragDropProvider } from '@dnd-kit/react'
import { FileUp } from 'lucide-react'
import { Link } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { ClearLibraryButton } from './ClearLibraryButton'
import { CertificationSection } from './CertificationSection'
import { EducationSection } from './EducationSection'
import { ExperienceSection } from './ExperienceSection'
import { FactsSection } from './FactsSection'
import { ImportSummaryNotice } from './ImportSummaryNotice'
import { ProfileSection } from './ProfileSection'
import { ProjectSection } from './ProjectSection'
import { SkillsSection } from './SkillsSection'
import { useCareerLibrary } from './useCareerLibrary'
import { useLibraryDragHandlers } from './useLibraryDragHandlers'
import { useLibraryReordering } from './useLibraryReordering'

/** Shows the profile, experiences, projects, education, skills, and facts. */
export function CareerLibraryPage() {
  const { library, loading, error } = useCareerLibrary()
  const reordering = useLibraryReordering()
  const { handlers, highlightsOf } = useLibraryDragHandlers(library, reordering)

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Career library</h1>
          <p className="text-muted-foreground">Everything your tailored resumes are built from.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {library && <ClearLibraryButton />}
          <Button asChild>
            <Link to="/import">
              <FileUp /> Import a resume
            </Link>
          </Button>
        </div>
      </div>
      <ImportSummaryNotice />
      {error && <ErrorAlert title="Couldn't load your library" messages={[requestErrorMessage(error, error.message)]} />}
      <ErrorAlert title="Couldn't save that change" messages={reordering.errors} />
      {!library && loading && <p className="text-muted-foreground">Loading…</p>}
      {library && (
        <DragDropProvider {...handlers}>
          <ProfileSection profile={library.me} />
          <ExperienceSection experiences={library.experiences} highlightsOf={highlightsOf} />
          <ProjectSection projects={library.projects} />
          <EducationSection educations={library.educations} />
          <CertificationSection certifications={library.certifications} />
          <SkillsSection skills={library.skills} />
          <FactsSection facts={library.libraryFacts} />
        </DragDropProvider>
      )}
    </div>
  )
}
