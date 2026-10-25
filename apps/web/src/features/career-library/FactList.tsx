/**
 * Description: Career library facts (answers the user keeps), each with edit and delete.
 * Responses also show their assessment and the shared individual AI editing controls.
 * Index:
 *   - LibraryFact: one fact as the library query returns it
 *   - FactList: renders the facts; deleting asks for confirmation
 */
import { useState } from 'react'
import { Pencil, X } from 'lucide-react'
import { LibraryAssessment, type Assessment } from './LibraryAssessment'
import { LibraryEditControl } from './LibraryEditControl'
import { DeleteEntryDialog } from './DeleteEntryDialog'
import { useLibraryEntryActions } from './useLibraryEntryActions'

export interface LibraryFact {
  id: string
  requirement: string
  response: string
}

/** Renders each fact and confirms before deleting it. */
export function FactList({ facts, onEdit, assessments = [] }: { facts: LibraryFact[]; onEdit: (fact: LibraryFact) => void; assessments?: Assessment[] }) {
  const [factToDelete, setFactToDelete] = useState<LibraryFact | null>(null)
  const { deleteEntry, busy, errors, clearErrors } = useLibraryEntryActions('fact')

  /** Opens the confirmation for a fact, or closes it with null. */
  function confirmDelete(fact: LibraryFact | null) {
    clearErrors()
    setFactToDelete(fact)
  }

  /** Deletes the chosen fact and closes the dialog on success. */
  async function deleteChosenFact() {
    if (factToDelete && (await deleteEntry(factToDelete.id))) setFactToDelete(null)
  }

  return (
    <ul className="grid gap-3">
      {facts.map((fact) => (
        <li key={fact.id} className="flex items-start justify-between gap-3 rounded-md border border-section-facts-accent/25 bg-section-facts/50 p-3">
          <div className="grid min-w-0 flex-1 gap-1">
            <p className="text-sm font-medium">{fact.requirement}</p>
            <p className="text-sm text-muted-foreground">{fact.response}</p>
            <LibraryAssessment assessment={assessments.find((item) => item.kind === 'library_fact' && item.recordId === fact.id)} />
            <LibraryEditControl kind="library_fact" recordId={fact.id} currentText={fact.response} sourceRevision={JSON.stringify(fact)} />
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              className="rounded-full p-1 hover:bg-foreground/10"
              aria-label={`Edit ${fact.requirement}`}
              onClick={() => onEdit(fact)}
            >
              <Pencil className="size-4" />
            </button>
            <button
              type="button"
              className="rounded-full p-1 hover:bg-foreground/10"
              aria-label={`Delete ${fact.requirement}`}
              onClick={() => confirmDelete(fact)}
            >
              <X className="size-4" />
            </button>
          </div>
        </li>
      ))}
      <DeleteEntryDialog
        open={factToDelete !== null}
        onOpenChange={(open) => !open && confirmDelete(null)}
        entryLabel={factToDelete?.requirement ?? ''}
        onConfirm={deleteChosenFact}
        busy={busy}
        errors={errors}
      />
    </ul>
  )
}
