/**
 * Description: Dialog that adds a role or edits one, including its bullet points.
 * Index:
 *   - ExperienceFormDialog: opens the form for a role, or a blank one when experience is null
 */
import { useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { CREATE_EXPERIENCE_MUTATION, UPDATE_EXPERIENCE_MUTATION } from './careerLibrarySaveMutations'
import { EntryFormDialog } from './EntryFormDialog'
import { HighlightEditor } from './HighlightEditor'
import { blankToNull, highlightsToSave } from './libraryFormValues'
import { LibraryField } from './LibraryField'
import { useSaveLibraryRecord } from './useSaveLibraryRecord'

type Experience = CareerLibraryQuery['experiences'][number]

interface ExperienceFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  experience: Experience | null
}

/** Shows the role form while `open` is true. Closing throws away unsaved edits. */
export function ExperienceFormDialog({ open, onOpenChange, experience }: ExperienceFormDialogProps) {
  if (!open) return null
  return <ExperienceForm key={experience?.id ?? 'new'} experience={experience} onClose={() => onOpenChange(false)} />
}

/** The role fields and the save action. */
function ExperienceForm({ experience, onClose }: { experience: Experience | null; onClose: () => void }) {
  const { save, busy, errors } = useSaveLibraryRecord()
  const [company, setCompany] = useState(experience?.company ?? '')
  const [title, setTitle] = useState(experience?.title ?? '')
  const [location, setLocation] = useState(experience?.location ?? '')
  const [startDate, setStartDate] = useState(experience?.startDate ?? '')
  const [endDate, setEndDate] = useState(experience?.endDate ?? '')
  const [currentRole, setCurrentRole] = useState(experience == null || experience.endDate == null)
  const [description, setDescription] = useState(experience?.description ?? '')
  const [highlights, setHighlights] = useState(experience?.highlights.map((highlight) => highlight.content) ?? [])

  /** Marks the role as current and clears its end date. */
  function markCurrent(checked: boolean) {
    setCurrentRole(checked)
    if (checked) setEndDate('')
  }

  /** Creates or updates the role. Unchanged bullets are left out of an update. */
  async function submit() {
    const highlightsToSend = highlightsToSave(highlights, experience ? experience.highlights.map((highlight) => highlight.content) : null)
    const saved = await save(experience ? UPDATE_EXPERIENCE_MUTATION : CREATE_EXPERIENCE_MUTATION, {
      ...(experience ? { id: experience.id } : {}),
      attributes: {
        company: company.trim(),
        title: title.trim(),
        location: blankToNull(location),
        startDate: blankToNull(startDate),
        endDate: currentRole ? null : blankToNull(endDate),
        description: blankToNull(description),
      },
      ...(highlightsToSend === undefined ? {} : { highlights: highlightsToSend }),
    })
    if (saved) onClose()
  }

  return (
    <EntryFormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={experience ? 'Edit role' : 'Add role'}
      description="Company and title are required. A current role has no end date."
      onSubmit={submit}
      busy={busy}
      errors={errors}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <LibraryField label="Title" required value={title} onChange={setTitle} />
        <LibraryField label="Company" required value={company} onChange={setCompany} />
        <LibraryField label="Location" value={location} onChange={setLocation} />
        <LibraryField label="Start" type="date" value={startDate} onChange={setStartDate} />
        <LibraryField label="End" type="date" value={endDate} onChange={setEndDate} disabled={currentRole} />
        <div className="flex items-center gap-2 self-end">
          <Checkbox id="current-role" checked={currentRole} onCheckedChange={(checked) => markCurrent(checked === true)} />
          <Label htmlFor="current-role">Current role</Label>
        </div>
      </div>
      <LibraryField label="Description" multiline value={description} onChange={setDescription} />
      <HighlightEditor highlights={highlights} onChange={setHighlights} />
    </EntryFormDialog>
  )
}
