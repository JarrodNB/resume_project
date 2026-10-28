/**
 * Description: Dialog that adds a context or edits one.
 * Index:
 *   - CareerContextFormDialog: opens the form for a context, or a blank one when context is null
 */
import { useState } from 'react'
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
}

/** Shows the context form while `open` is true. */
export function CareerContextFormDialog({ open, onOpenChange, context }: CareerContextFormDialogProps) {
  if (!open) return null
  return <CareerContextForm key={context?.id ?? 'new'} context={context} onClose={() => onOpenChange(false)} />
}

/** The context fields and the save action. */
function CareerContextForm({ context, onClose }: { context: CareerContext | null; onClose: () => void }) {
  const { save, busy, errors } = useSaveLibraryRecord()
  const [requirement, setRequirement] = useState(context?.requirement ?? '')
  const [response, setResponse] = useState(context?.response ?? '')

  /** Creates or updates the context. Both fields are required. */
  async function submit() {
    const saved = await save(context ? UPDATE_CAREER_CONTEXT_MUTATION : CREATE_CAREER_CONTEXT_MUTATION, {
      ...(context ? { id: context.id } : {}),
      attributes: { requirement: requirement.trim(), response: response.trim() },
    })
    if (saved) onClose()
  }

  return (
    <EntryFormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={context ? 'Edit career context' : 'Add career context'}
      description="A requirement and your answer. Later comparisons can use this."
      onSubmit={submit}
      busy={busy}
      errors={errors}
    >
      <LibraryField label="Requirement" required value={requirement} onChange={setRequirement} maxLength={BULLET_TEXT} />
      <LibraryField label="Response" required multiline value={response} onChange={setResponse} maxLength={PROSE_TEXT} />
    </EntryFormDialog>
  )
}
