/**
 * Description: Dialog that adds an education entry or edits one.
 * Selecting the ongoing option clears the end date and saves that status explicitly.
 * A blank end date alone stays unknown, including entries saved before ongoing status existed.
 * Index:
 *   - EducationFormDialog: opens the form for a school, or a blank one when education is null
 */
import { useId, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { CREATE_EDUCATION_MUTATION, UPDATE_EDUCATION_MUTATION } from './careerLibrarySaveMutations'
import { EntryFormDialog } from './EntryFormDialog'
import { blankToNull, requiredFieldErrors } from './libraryFormValues'
import { PROSE_TEXT, SHORT_TEXT } from '@/lib/textLimits'
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
  const ongoingId = useId()
  const [currentlyStudying, setOngoing] = useState(education?.ongoing ?? false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [institution, setInstitution] = useState(education?.institution ?? '')
  const [degree, setDegree] = useState(education?.degree ?? '')
  const [fieldOfStudy, setFieldOfStudy] = useState(education?.fieldOfStudy ?? '')
  const [startDate, setStartDate] = useState(education?.startDate ?? '')
  const [endDate, setEndDate] = useState(education?.endDate ?? '')
  const [description, setDescription] = useState(education?.description ?? '')

  /** Creates or updates the education, sending every field so a cleared one is removed. */
  async function submit() {
    const missing = requiredFieldErrors({ institution: { label: 'Institution', value: institution } })
    setFieldErrors(missing)
    if (Object.keys(missing).length) return
    const saved = await save(education ? UPDATE_EDUCATION_MUTATION : CREATE_EDUCATION_MUTATION, {
      ...(education ? { id: education.id } : {}),
      attributes: {
        institution: institution.trim(),
        degree: blankToNull(degree),
        fieldOfStudy: blankToNull(fieldOfStudy),
        startDate: blankToNull(startDate),
        endDate: currentlyStudying ? null : blankToNull(endDate),
        ongoing: currentlyStudying,
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
        <LibraryField label="Institution" required error={fieldErrors.institution} value={institution} onChange={setInstitution} maxLength={SHORT_TEXT} />
        <LibraryField label="Degree" value={degree} onChange={setDegree} maxLength={SHORT_TEXT} />
        <LibraryField label="Field of study" value={fieldOfStudy} onChange={setFieldOfStudy} maxLength={SHORT_TEXT} />
        <LibraryField label="Start" type="date" value={startDate} onChange={setStartDate} />
        <LibraryField label="End" type="date" value={endDate} onChange={setEndDate} disabled={currentlyStudying} />
        <div className="flex items-center gap-2 self-end">
          <Checkbox id={ongoingId} checked={currentlyStudying} onCheckedChange={(checked) => {
            setOngoing(checked === true)
            if (checked === true) setEndDate('')
          }} />
          <Label htmlFor={ongoingId}>Currently studying</Label>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">Select Currently studying if this is still in progress. Otherwise, you can leave End blank if the date is unknown.</p>
      <LibraryField label="Description" multiline value={description} onChange={setDescription} maxLength={PROSE_TEXT} />
    </EntryFormDialog>
  )
}
