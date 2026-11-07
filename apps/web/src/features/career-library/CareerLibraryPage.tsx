/**
 * Description: Career library page: everything known about the user's career (the source of truth
 * for tailoring), starting with their profile. Roles, projects, and education are listed most
 * recent first (the API orders them by date). Entries can be added, edited, deleted, or merged;
 * highlights can be dragged to a new place or into another role, and skills within their category.
 * Section tabs can be dragged, which sets the default section order for new resumes. The
 * profile stays first and career context stays last, because it is evidence rather than a separate resume section.
 * Every section shows its records on one long page, with sticky tabs for jumping between them.
 * The whole library can be deleted so a new resume import starts fresh (the button is hidden
 * while the library is empty). Saves show a toast and scroll to the changed section.
 * Index:
 *   - CareerLibraryPage: page component
 */
import { ContentSkeleton } from '@/components/ContentSkeleton'
import { Fragment } from 'react'
import { DragDropProvider } from '@dnd-kit/react'
import { PageHeading } from '@/components/PageHeading'
import { ErrorAlert } from '@/components/ErrorAlert'
import { ResumeUpload } from '@/features/resume-import/ResumeUpload'
import type { MovableSectionType } from '@/features/resume-tailoring/sectionOrder'
import { useDefaultSectionOrder } from '@/features/resume-tailoring/useDefaultSectionOrder'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { LibraryWorkspace } from './LibraryWorkspace'
import { LibraryAiWorkspace } from './LibraryAiWorkspace'
import { LibraryTabs } from './LibraryTabs'
import { LibrarySaveNoticeProvider } from './LibrarySaveNotice'
import { ClearLibraryButton } from './ClearLibraryButton'
import { CertificationSection } from './CertificationSection'
import { EducationSection } from './EducationSection'
import { ExperienceSection } from './ExperienceSection'
import { CareerContextSection } from './CareerContextSection'
import { ImportSummaryNotice } from './ImportSummaryNotice'
import { ProfileSection } from './ProfileSection'
import { ProjectSection } from './ProjectSection'
import { SkillsSection } from './SkillsSection'
import { SummarySection } from './SummarySection'
import { libraryHasContent } from './libraryHasContent'
import { useCareerLibrary } from './useCareerLibrary'
import { useLibraryDragHandlers } from './useLibraryDragHandlers'
import { useLibraryReordering } from './useLibraryReordering'

/** Shows the profile, experiences, projects, education, skills, and career context. */
export function CareerLibraryPage() {
  const { library, loading, error } = useCareerLibrary()
  const reordering = useLibraryReordering()
  const sectionOrder = useDefaultSectionOrder()
  const { handlers, highlightsOf } = useLibraryDragHandlers(library, reordering, sectionOrder.order, (order) => void sectionOrder.saveOrder(order))

  /** One movable library section. */
  function renderSection(section: MovableSectionType) {
    if (!library) return null
    switch (section) {
      case 'summary': return <SummarySection profile={library.me} libraryHasContent={libraryHasContent(library)} />
      case 'experience': return <ExperienceSection experiences={library.experiences} highlightsOf={highlightsOf} movingHighlight={reordering.movingHighlight} />
      case 'projects': return <ProjectSection projects={library.projects} />
      case 'education': return <EducationSection educations={library.educations} />
      case 'certifications': return <CertificationSection certifications={library.certifications} />
      case 'skills': return <SkillsSection skills={library.skills} />
    }
  }

  return (
    <LibrarySaveNoticeProvider>
    <div className="library-page">
      {(!library || sectionOrder.loading) && <div className="section-tabs library-tabs" aria-hidden />}
      <PageHeading title="Career library" description="Your experience, all in one place. The foundation for every application." />
      <ImportSummaryNotice />
      {error && <ErrorAlert title="Couldn't load your library" messages={[requestErrorMessage(error, error.message)]} />}
      <ErrorAlert title="Couldn't save that change" messages={[...reordering.errors, ...sectionOrder.errors]} />
      {((!library && loading) || (library && sectionOrder.loading)) && <ContentSkeleton label="Loading your career library…" layout="sections" />}
      {library && !libraryHasContent(library) && (
        <section className="library-resume-import" aria-labelledby="resume-import-heading">
          <div className="grid gap-2">
            <h2 id="resume-import-heading">Start with your resume</h2>
            <p>Import a PDF or Word resume and review what it finds before anything is saved, or add your roles and skills by hand below. Jobs are compared against this library, so the more real detail it holds, the better the comparisons.</p>
          </div>
          <ResumeUpload />
        </section>
      )}
      {library && !sectionOrder.loading && (
        <LibraryWorkspace library={library} movingHighlight={reordering.movingHighlight}>
          <DragDropProvider {...handlers}>
            <LibraryTabs library={library} order={sectionOrder.order} />
            <div className="library-sections">
              <ProfileSection profile={library.me} />
              {sectionOrder.order.map((section) => <Fragment key={section}>{renderSection(section)}</Fragment>)}
              <CareerContextSection careerContexts={library.careerContexts} />
              {libraryHasContent(library) && <div className="library-clear"><ClearLibraryButton /></div>}
            </div>
          </DragDropProvider>
          <LibraryAiWorkspace />
        </LibraryWorkspace>
      )}
    </div>
    </LibrarySaveNoticeProvider>
  )
}
