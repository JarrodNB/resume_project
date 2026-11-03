/**
 * Description: Career library page: everything known about the user's career (the source of truth
 * for tailoring), starting with their profile. Roles, projects, and education are listed most
 * recent first (the API orders them by date). Entries can be added, edited, deleted, or merged;
 * highlights can be dragged to a new place or into another role, and skills within their category.
 * Whole sections can be dragged too, which sets the default section order for new resumes. The
 * profile stays first and career context stays last, because it never prints on a resume.
 * The whole library can be deleted so a new resume import starts fresh.
 * Index:
 *   - CareerLibraryPage: page component
 */
import { ContentSkeleton } from '@/components/ContentSkeleton'
import type { ReactNode } from 'react'
import { DragDropProvider } from '@dnd-kit/react'
import { sortableId } from '@/components/dnd/moveItems'
import { SortableItem } from '@/components/dnd/SortableItem'
import { PageHeading } from '@/components/PageHeading'
import { ErrorAlert } from '@/components/ErrorAlert'
import { ResumeUpload } from '@/features/resume-import/ResumeUpload'
import { SECTION_TITLES, type MovableSectionType } from '@/features/resume-tailoring/sectionOrder'
import { useDefaultSectionOrder } from '@/features/resume-tailoring/useDefaultSectionOrder'
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
import { SummarySection } from './SummarySection'
import { libraryHasContent } from './libraryHasContent'
import { useCareerLibrary } from './useCareerLibrary'
import { LIBRARY_SECTION_TYPE, useLibraryDragHandlers } from './useLibraryDragHandlers'
import { useLibraryReordering } from './useLibraryReordering'

/** Shows the profile, experiences, projects, education, skills, and career context. */
export function CareerLibraryPage() {
  const { library, loading, error } = useCareerLibrary()
  const reordering = useLibraryReordering()
  const sectionOrder = useDefaultSectionOrder()
  const { handlers, highlightsOf } = useLibraryDragHandlers(library, reordering, sectionOrder.order, (order) => void sectionOrder.saveOrder(order))

  /** One movable library section, with the handle that drags it. */
  function renderSection(section: MovableSectionType, dragHandle: ReactNode) {
    if (!library) return null
    switch (section) {
      case 'summary': return <SummarySection profile={library.me} dragHandle={dragHandle} />
      case 'experience': return <ExperienceSection experiences={library.experiences} highlightsOf={highlightsOf} movingHighlight={reordering.movingHighlight} dragHandle={dragHandle} />
      case 'projects': return <ProjectSection projects={library.projects} dragHandle={dragHandle} />
      case 'education': return <EducationSection educations={library.educations} dragHandle={dragHandle} />
      case 'certifications': return <CertificationSection certifications={library.certifications} dragHandle={dragHandle} />
      case 'skills': return <SkillsSection skills={library.skills} dragHandle={dragHandle} />
    }
  }

  return (
    <div className="library-page mx-auto grid gap-6">
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
        <div className="library-workspace-layout">
          <div className="library-sections">
            <DragDropProvider {...handlers}>
              <ProfileSection profile={library.me} />
              {sectionOrder.order.map((section, index) => (
                <SortableItem key={section} id={sortableId(LIBRARY_SECTION_TYPE, section)} index={index} type={LIBRARY_SECTION_TYPE} label={`${SECTION_TITLES[section]} section`}>
                  {(dragHandle) => renderSection(section, dragHandle)}
                </SortableItem>
              ))}
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
