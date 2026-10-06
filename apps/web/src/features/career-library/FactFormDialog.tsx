/**
 * Description: Dialog that adds a fact or edits one.
 * Index:
 *   - FactFormDialog: opens the form for a fact, or a blank one when fact is null
 */
import { useState } from 'react'
import { CREATE_LIBRARY_FACT_MUTATION, UPDATE_LIBRARY_FACT_MUTATION } from './careerLibrarySaveMutations'
import { EntryFormDialog } from './EntryFormDialog'
import { LibraryField } from './LibraryField'
import type { LibraryFact } from './FactList'
import { useSaveLibraryRecord } from './useSaveLibraryRecord'

interface FactFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fact: LibraryFact | null
}

/** Shows the fact form while `open` is true. */
export function FactFormDialog({ open, onOpenChange, fact }: FactFormDialogProps) {
  if (!open) return null
  return <FactForm key={fact?.id ?? 'new'} fact={fact} onClose={() => onOpenChange(false)} />
}

/** The fact fields and the save action. */
function FactForm({ fact, onClose }: { fact: LibraryFact | null; onClose: () => void }) {
  const { save, busy, errors } = useSaveLibraryRecord()
  const [requirement, setRequirement] = useState(fact?.requirement ?? '')
  const [response, setResponse] = useState(fact?.response ?? '')

  /** Creates or updates the fact. Both fields are required. */
  async function submit() {
    const saved = await save(fact ? UPDATE_LIBRARY_FACT_MUTATION : CREATE_LIBRARY_FACT_MUTATION, {
      ...(fact ? { id: fact.id } : {}),
      attributes: { requirement: requirement.trim(), response: response.trim() },
    })
    if (saved) onClose()
  }

  return (
    <EntryFormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={fact ? 'Edit fact' : 'Add fact'}
      description="A requirement and your answer. Later comparisons can use this."
      onSubmit={submit}
      busy={busy}
      errors={errors}
    >
      <LibraryField label="Requirement" required value={requirement} onChange={setRequirement} />
      <LibraryField label="Response" required multiline value={response} onChange={setResponse} />
    </EntryFormDialog>
  )
}
