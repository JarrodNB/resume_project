/**
 * Description: Career library career context entries (answers the user keeps), each with edit and delete.
 * Responses also show their assessment and the shared individual AI editing controls.
 * Index:
 *   - CareerContext: one context as the library query returns it
 *   - CareerContextList: renders the career context entries; deleting asks for confirmation
 */
import { useState } from 'react'
import { Pencil, X } from 'lucide-react'
import { LibraryDetail } from './LibraryDetail'
import { DeleteEntryDialog } from './DeleteEntryDialog'
import { useLibraryEntryActions } from './useLibraryEntryActions'

export interface CareerContext {
  id: string
  requirement: string
  response: string
}

/** Renders each context and confirms before deleting it. */
export function CareerContextList({ careerContexts, onEdit }: { careerContexts: CareerContext[]; onEdit: (context: CareerContext) => void }) {
  const [contextToDelete, setContextToDelete] = useState<CareerContext | null>(null)
  const { deleteEntry, busy, errors, clearErrors } = useLibraryEntryActions('career_context')

  /** Opens the confirmation for a context, or closes it with null. */
  function confirmDelete(context: CareerContext | null) {
    clearErrors()
    setContextToDelete(context)
  }

  /** Deletes the chosen context and closes the dialog on success. */
  async function deleteChosenContext() {
    if (contextToDelete && (await deleteEntry(contextToDelete.id))) setContextToDelete(null)
  }

  return (
    <ul className="library-contexts">
      {careerContexts.map((context) => (
        <li key={context.id} className="library-context">
          <div className="library-context-head">
          <p className="library-context-requirement">{context.requirement}</p>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              className="rounded-full p-1 hover:bg-foreground/10"
              aria-label={`Edit ${context.requirement}`}
              onClick={() => onEdit(context)}
            >
              <Pencil className="size-4" />
            </button>
            <button
              type="button"
              className="rounded-full p-1 hover:bg-foreground/10"
              aria-label={`Delete ${context.requirement}`}
              onClick={() => confirmDelete(context)}
            >
              <X className="size-4" />
            </button>
          </div>
          </div>
          <LibraryDetail kind="career_context" recordId={context.id} text={context.response} />
        </li>
      ))}
      <DeleteEntryDialog
        open={contextToDelete !== null}
        onOpenChange={(open) => !open && confirmDelete(null)}
        entryLabel={contextToDelete?.requirement ?? ''}
        onConfirm={deleteChosenContext}
        busy={busy}
        errors={errors}
      />
    </ul>
  )
}
