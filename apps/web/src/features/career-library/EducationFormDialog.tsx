/**
 * Description: Dialog that adds an education entry or edits one.
 * Index:
 *   - EducationFormDialog: opens the form for a school, or a blank one when education is null
 */
import { useState } from 'react'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { CREATE_EDUCATION_MUTATION, UPDATE_EDUCATION_MUTATION } from './careerLibrarySaveMutations'
import { EntryFormDialog } from './EntryFormDialog'
import { blankToNull } from './libraryFormValues'
import { LibraryField } from './LibraryField'
import { useSaveLibraryRecord } from './useSaveLibraryRecord'

type Education = CareerLibraryQuery['educations'][number]

interface EducationFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  education: Education | null
}

/** Shows the education form while `open` is true. */
export function EducationFormDialog({ open, onOpenChange, education }: EducationFormDialogProps) {
  if (!open) return null
  return <EducationForm key={education?.id ?? 'new'} education={education} onClose={() => onOpenChange(false)} />
}

/** The education fields and the save action. */
function EducationForm({ education, onClose }: { education: Education | null; onClose: () => void }) {
  const { save, busy, errors } = useSaveLibraryRecord()
  const [institution, setInstitution] = useState(education?.institution ?? '')
  const [degree, setDegree] = useState(education?.degree ?? '')
  const [fieldOfStudy, setFieldOfStudy] = useState(education?.fieldOfStudy ?? '')
  const [startDate, setStartDate] = useState(education?.startDate ?? '')
  const [endDate, setEndDate] = useState(education?.endDate ?? '')
  const [description, setDescription] = useState(education?.description ?? '')

  /** Creates or updates the education, sending every field so a cleared one is removed. */
  async function submit() {
    const saved = await save(education ? UPDATE_EDUCATION_MUTATION : CREATE_EDUCATION_MUTATION, {
      ...(education ? { id: education.id } : {}),
      attributes: {
        institution: institution.trim(),
        degree: blankToNull(degree),
        fieldOfStudy: blankToNull(fieldOfStudy),
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
      title={education ? 'Edit education' : 'Add education'}
      description="The institution is required."
      onSubmit={submit}
      busy={busy}
      errors={errors}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <LibraryField label="Institution" required value={institution} onChange={setInstitution} />
        <LibraryField label="Degree" value={degree} onChange={setDegree} />
        <LibraryField label="Field of study" value={fieldOfStudy} onChange={setFieldOfStudy} />
        <LibraryField label="Start" type="date" value={startDate} onChange={setStartDate} />
        <LibraryField label="End" type="date" value={endDate} onChange={setEndDate} />
      </div>
      <LibraryField label="Description" multiline value={description} onChange={setDescription} />
    </EntryFormDialog>
  )
}
