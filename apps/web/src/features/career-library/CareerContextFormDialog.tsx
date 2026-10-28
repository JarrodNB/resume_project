/**
 * Adds or edits a career context, including reviewed copies of interview answers.
 * Initial values for a new entry are editable and never change the source record.
 * Index:
 *   - CareerContextFormDialog: opens the form for a context, or a blank one when context is null
 */
import { useRef, useState } from 'react'
import { CREATE_CAREER_CONTEXT_MUTATION, UPDATE_CAREER_CONTEXT_MUTATION } from './careerLibrarySaveMutations'
import { EntryFormDialog } from './EntryFormDialog'
import { BULLET_TEXT, PROSE_TEXT } from '@/lib/textLimits'
import { LibraryField } from './LibraryField'
import type { CareerContext } from './CareerContextList'
import { useSaveLibraryRecord } from './useSaveLibraryRecord'

interface CareerContextFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  context: CareerContext | null
  initialValues?: { requirement: string; response: string }
  onSaved?: () => void
}

/** Shows the context form while `open` is true. */
export function CareerContextFormDialog({ open, onOpenChange, context, initialValues, onSaved }: CareerContextFormDialogProps) {
  if (!open) return null
  return <CareerContextForm key={context?.id ?? 'new'} context={context} initialValues={initialValues} onSaved={onSaved} onClose={() => onOpenChange(false)} />
}

/** The context fields and the save action. */
function CareerContextForm({ context, initialValues, onSaved, onClose }: Pick<CareerContextFormDialogProps, 'context' | 'initialValues' | 'onSaved'> & { onClose: () => void }) {
  const { save, busy, errors } = useSaveLibraryRecord()
  const [requirement, setRequirement] = useState(context?.requirement ?? initialValues?.requirement ?? '')
  const [response, setResponse] = useState(context?.response ?? initialValues?.response ?? '')

  const submitting = useRef(false)
  const [validationErrors, setValidationErrors] = useState<string[]>([])

  /** Creates or updates the context. Both fields are required. */
  async function submit() {
    if (submitting.current) return
    const problems = []
    if (!requirement.trim() || !response.trim()) problems.push('Requirement and response are required.')
    if (requirement.trim().length > BULLET_TEXT) problems.push(`Requirement must be ${BULLET_TEXT} characters or fewer. Edit the question before saving.`)
    if (response.trim().length > PROSE_TEXT) problems.push(`Response must be ${PROSE_TEXT} characters or fewer. Edit the answer before saving.`)
    setValidationErrors(problems)
    if (problems.length) return
    submitting.current = true
    const saved = await save(context ? UPDATE_CAREER_CONTEXT_MUTATION : CREATE_CAREER_CONTEXT_MUTATION, {
      ...(context ? { id: context.id } : {}),
      attributes: { requirement: requirement.trim(), response: response.trim() },
    })
    submitting.current = false
    if (saved) { onSaved?.(); onClose() }
  }

  return (
    <EntryFormDialog
      open
      onOpenChange={(next) => !next && !submitting.current && onClose()}
      title={context ? 'Edit career context' : 'Add career context'}
      description="A requirement and your answer. Later comparisons can use this."
      onSubmit={submit}
      busy={busy}
      errors={[...validationErrors, ...errors]}
    >
      <LibraryField label="Requirement" required value={requirement} onChange={setRequirement} maxLength={BULLET_TEXT} />
      <LibraryField label="Response" required multiline value={response} onChange={setResponse} maxLength={PROSE_TEXT} />
    </EntryFormDialog>
  )
}
