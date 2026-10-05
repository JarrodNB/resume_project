/**
 * Description: Career library facts (answers added from a gap analysis), each with a delete button.
 * Index:
 *   - LibraryFact: one fact as the library query returns it
 *   - FactList: renders the facts; deleting asks for confirmation
 */
import { useState } from 'react'
import { X } from 'lucide-react'
import { DeleteEntryDialog } from './DeleteEntryDialog'
import { useLibraryEntryActions } from './useLibraryEntryActions'

export interface LibraryFact {
  id: string
  requirement: string
  response: string
}

/** Renders each fact and confirms before deleting it. */
export function FactList({ facts }: { facts: LibraryFact[] }) {
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
          <div className="grid gap-1">
            <p className="text-sm font-medium">{fact.requirement}</p>
            <p className="text-sm text-muted-foreground">{fact.response}</p>
          </div>
          <button
            type="button"
            className="rounded-full p-1 hover:bg-foreground/10"
            aria-label={`Delete ${fact.requirement}`}
            onClick={() => confirmDelete(fact)}
          >
            <X className="size-4" />
          </button>
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
