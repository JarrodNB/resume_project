/**
 * Description: Dialog that adds a project or edits one.
 * Index:
 *   - ProjectFormDialog: opens the form for a project, or a blank one when project is null
 */
import { useState } from 'react'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { CREATE_PROJECT_MUTATION, UPDATE_PROJECT_MUTATION } from './careerLibrarySaveMutations'
import { EntryFormDialog } from './EntryFormDialog'
import { blankToNull } from './libraryFormValues'
import { LibraryField } from './LibraryField'
import { useSaveLibraryRecord } from './useSaveLibraryRecord'

type Project = CareerLibraryQuery['projects'][number]

interface ProjectFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project | null
}

/** Shows the project form while `open` is true. */
export function ProjectFormDialog({ open, onOpenChange, project }: ProjectFormDialogProps) {
  if (!open) return null
  return <ProjectForm key={project?.id ?? 'new'} project={project} onClose={() => onOpenChange(false)} />
}

/** The project fields and the save action. */
function ProjectForm({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const { save, busy, errors } = useSaveLibraryRecord()
  const [name, setName] = useState(project?.name ?? '')
  const [role, setRole] = useState(project?.role ?? '')
  const [url, setUrl] = useState(project?.url ?? '')
  const [startDate, setStartDate] = useState(project?.startDate ?? '')
  const [endDate, setEndDate] = useState(project?.endDate ?? '')
  const [description, setDescription] = useState(project?.description ?? '')

  /** Creates or updates the project, sending every field so a cleared one is removed. */
  async function submit() {
    const saved = await save(project ? UPDATE_PROJECT_MUTATION : CREATE_PROJECT_MUTATION, {
      ...(project ? { id: project.id } : {}),
      attributes: {
        name: name.trim(),
        role: blankToNull(role),
        url: blankToNull(url),
        startDate: blankToNull(startDate),
        endDate: blankToNull(endDate),
        description: blankToNull(description),
      },
    })
    if (saved) onClose()
  }

  return (
    <EntryFormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={project ? 'Edit project' : 'Add project'}
      description="The name is required."
      onSubmit={submit}
      busy={busy}
      errors={errors}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <LibraryField label="Name" required value={name} onChange={setName} />
        <LibraryField label="Role" value={role} onChange={setRole} />
        <LibraryField label="URL" type="url" value={url} onChange={setUrl} />
        <LibraryField label="Start" type="date" value={startDate} onChange={setStartDate} />
        <LibraryField label="End" type="date" value={endDate} onChange={setEndDate} />
      </div>
      <LibraryField label="Description" multiline value={description} onChange={setDescription} />
    </EntryFormDialog>
  )
}
