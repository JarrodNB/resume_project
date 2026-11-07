/**
 * Description: Dialog that adds a project or edits one.
 * Selecting the ongoing option clears the end date and saves that status explicitly.
 * A blank end date alone stays unknown, including entries saved before ongoing status existed.
 * Index:
 *   - ProjectFormDialog: opens the form for a project, or a blank one when project is null
 */
import { useId, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { CREATE_PROJECT_MUTATION, UPDATE_PROJECT_MUTATION } from './careerLibrarySaveMutations'
import { EntryFormDialog } from './EntryFormDialog'
import { blankToNull, requiredFieldErrors, normalizeWebAddress } from './libraryFormValues'
import { PROSE_TEXT, SHORT_TEXT } from '@/lib/textLimits'
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
  const ongoingId = useId()
  const [ongoing, setOngoing] = useState(project?.ongoing ?? false)
  const [name, setName] = useState(project?.name ?? '')
  const [role, setRole] = useState(project?.role ?? '')
  const [url, setUrl] = useState(project?.url ?? '')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [startDate, setStartDate] = useState(project?.startDate ?? '')
  const [endDate, setEndDate] = useState(project?.endDate ?? '')
  const [description, setDescription] = useState(project?.description ?? '')

  /** Creates or updates the project, sending every field so a cleared one is removed. */
  async function submit() {
    const missing = requiredFieldErrors({ name: { label: 'Name', value: name } })
    const address = normalizeWebAddress(url)
    if (address.error) missing.url = address.error
    setFieldErrors(missing)
    if (Object.keys(missing).length) return
    const saved = await save(project ? UPDATE_PROJECT_MUTATION : CREATE_PROJECT_MUTATION, {
      ...(project ? { id: project.id } : {}),
      attributes: {
        name: name.trim(),
        role: blankToNull(role),
        url: address.value,
        startDate: blankToNull(startDate),
        endDate: ongoing ? null : blankToNull(endDate),
        ongoing: ongoing,
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
        <LibraryField label="Name" required error={fieldErrors.name} value={name} onChange={setName} maxLength={SHORT_TEXT} />
        <LibraryField label="Role" value={role} onChange={setRole} maxLength={SHORT_TEXT} />
        <LibraryField label="URL" error={fieldErrors.url} value={url} onChange={setUrl} maxLength={SHORT_TEXT} />
        <LibraryField label="Start" type="date" value={startDate} onChange={setStartDate} />
        <LibraryField label="End" type="date" value={endDate} onChange={setEndDate} disabled={ongoing} />
        <div className="flex items-center gap-2 self-end">
          <Checkbox id={ongoingId} checked={ongoing} onCheckedChange={(checked) => {
            setOngoing(checked === true)
            if (checked === true) setEndDate('')
          }} />
          <Label htmlFor={ongoingId}>Ongoing</Label>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">Select Ongoing if this is still in progress. Otherwise, you can leave End blank if the date is unknown.</p>
      <LibraryField label="Description" multiline value={description} onChange={setDescription} maxLength={PROSE_TEXT} />
    </EntryFormDialog>
  )
}
