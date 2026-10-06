/**
 * Description: The projects section of the career library: the dated list, add, and edit.
 * Index:
 *   - ProjectSection: projects with merge/delete and the project form
 */
import { useState } from 'react'
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
  const [editing, setEditing] = useState<Project | 'new' | null>(null)
  const candidates = projects.map((project) => ({ id: project.id, label: projectLabel(project) }))

  return (
    <>
      <LibrarySection sectionId="library.projects" tone="projects" title="Projects" count={projects.length} emptyText="No projects yet." addLabel="Add project" onAdd={() => setEditing('new')}>
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
          />
        ))}
      </LibrarySection>
      <ProjectFormDialog open={editing !== null} project={editing === 'new' ? null : editing} onOpenChange={(open) => !open && setEditing(null)} />
    </>
  )
}
