/**
 * Description: The projects section of the career library: the dated list, add, and edit.
 * Description review and regeneration use the same AI controls as other narrative sections.
 * Index:
 *   - ProjectSection: projects with merge/delete and the project form
 */
import { useState } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { LibraryAssessment } from './LibraryAssessment'
import { LibraryEditControl } from './LibraryEditControl'
import { useLibraryReview } from './useLibraryReview'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { formatDateRange } from '@/lib/formatDateRange'
import { LibraryEntry } from './LibraryEntry'
import { LibraryEntryActions } from './LibraryEntryActions'
import { projectLabel } from './libraryEntryLabels'
import { LibrarySection } from './LibrarySection'
import { ProjectFormDialog } from './ProjectFormDialog'

type Project = CareerLibraryQuery['projects'][number]

/** Lists projects and opens the form to add one or edit one. */
export function ProjectSection({ projects }: { projects: Project[] }) {
  const review = useLibraryReview('projects', JSON.stringify(projects))
  const [editing, setEditing] = useState<Project | 'new' | null>(null)
  const candidates = projects.map((project) => ({ id: project.id, label: projectLabel(project) }))

  return (
    <>
      <LibrarySection sectionId="library.projects" tone="projects" title="Projects" count={projects.length} emptyText="No projects yet." addLabel="Add project" onAdd={() => setEditing('new')}
        reviewActions={<Button variant="outline" size="sm" onClick={() => void review.start()} disabled={review.busy || !projects.some((entry) => entry.description)}>{review.busy ? 'Reviewing…' : 'Review Projects'}</Button>}>
        <ErrorAlert title="Could not review Projects" messages={review.errors} />
        {projects.map((project, index) => (
          <LibraryEntry
            key={project.id}
            tone="projects"
            heading={project.name}
            subheading={[project.role, project.url].filter(Boolean).join(' · ')}
            dates={formatDateRange(project.startDate, project.endDate)}
            description={project.description}
            actions={
              <LibraryEntryActions
                kind="project"
                entryId={project.id}
                entryLabel={candidates[index].label}
                mergeCandidates={candidates.filter((candidate) => candidate.id !== project.id)}
                onEdit={() => setEditing(project)}
              />
            }
          >
            {project.description && <>
              <LibraryAssessment assessment={review.assessments.find((item) => item.kind === 'project' && item.recordId === project.id)} />
              <LibraryEditControl kind="project" recordId={project.id} currentText={project.description} sourceRevision={JSON.stringify(project)} />
            </>}
          </LibraryEntry>
        ))}
      </LibrarySection>
      <ProjectFormDialog open={editing !== null} project={editing === 'new' ? null : editing} onOpenChange={(open) => !open && setEditing(null)} />
    </>
  )
}
