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
import { PageHeading } from '@/components/PageHeading'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { LibraryWorkspace } from './LibraryWorkspace'
import { LibraryAiWorkspace } from './LibraryAiWorkspace'
import { ClearLibraryButton } from './ClearLibraryButton'
import { CertificationSection } from './CertificationSection'
import { EducationSection } from './EducationSection'
import { ExperienceSection } from './ExperienceSection'
import { CareerContextSection } from './CareerContextSection'
import { ImportSummaryNotice } from './ImportSummaryNotice'
import { ProfileSection } from './ProfileSection'
import { ProjectSection } from './ProjectSection'
import { SkillsSection } from './SkillsSection'
import { useCareerLibrary } from './useCareerLibrary'
import { useLibraryDragHandlers } from './useLibraryDragHandlers'
import { useLibraryReordering } from './useLibraryReordering'

/** Shows the profile, experiences, projects, education, skills, and career context. */
export function CareerLibraryPage() {
  const { library, loading, error } = useCareerLibrary()
  const reordering = useLibraryReordering()
  const { handlers, highlightsOf } = useLibraryDragHandlers(library, reordering)

  return (
    <div className="library-page mx-auto grid gap-6">
      <PageHeading title="Career library" description="Your experience, all in one place. The foundation for every application." actions={
        <Button asChild><Link to="/library/import"><FileUp /> Import a resume</Link></Button>
      } />
      <ImportSummaryNotice />
      {error && <ErrorAlert title="Couldn't load your library" messages={[requestErrorMessage(error, error.message)]} />}
      <ErrorAlert title="Couldn't save that change" messages={reordering.errors} />
      {!library && loading && <p className="text-muted-foreground">Loading…</p>}
      {library && (
        <LibraryWorkspace library={library} movingHighlight={reordering.movingHighlight}>
        <div className="library-workspace-layout">
          <div className="library-sections">
            <DragDropProvider {...handlers}>
              <ProfileSection profile={library.me} />
              <ExperienceSection experiences={library.experiences} highlightsOf={highlightsOf} movingHighlight={reordering.movingHighlight} />
              <ProjectSection projects={library.projects} />
              <EducationSection educations={library.educations} />
              <CertificationSection certifications={library.certifications} />
              <SkillsSection skills={library.skills} />
              <CareerContextSection careerContexts={library.careerContexts} />
            </DragDropProvider>
            <div className="mt-4 flex justify-end border-t pt-4"><ClearLibraryButton /></div>
          </div>
          <LibraryAiWorkspace />
        </div>
        </LibraryWorkspace>
      )}
    </div>
  )
}
