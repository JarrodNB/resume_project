/**
 * Description: "…" menu on a career library entry with Edit, Delete, and, for mergeable kinds,
 * "Merge into…". Delete and merge open confirmation dialogs.
 * Index:
 *   - LibraryEntryActions: menu plus edit, delete, and merge dialogs for one entry
 */
import { useState } from 'react'
import { Ellipsis } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { DeleteEntryDialog } from './DeleteEntryDialog'
import { MergeEntryDialog, type MergeCandidate } from './MergeEntryDialog'
import { useLibraryEntryActions, type MergeableEntryKind } from './useLibraryEntryActions'

interface LibraryEntryActionsProps {
  kind: MergeableEntryKind
  entryId: string
  entryLabel: string
  mergeCandidates: MergeCandidate[]
  onEdit: () => void
}

type OpenDialog = 'delete' | 'merge' | null

/** Renders the actions menu; "Merge into…" only appears when there is another entry to merge into. */
export function LibraryEntryActions({ kind, entryId, entryLabel, mergeCandidates, onEdit }: LibraryEntryActionsProps) {
  const [openDialog, setOpenDialog] = useState<OpenDialog>(null)
  const { deleteEntry, mergeEntries, busy, errors, clearErrors } = useLibraryEntryActions(kind)

  /** Opens or closes a dialog, clearing errors from an earlier attempt. */
  function showDialog(dialog: OpenDialog) {
    clearErrors()
    setOpenDialog(dialog)
  }

  /** Closes the dialog when the action succeeded. */
  async function closeOnSuccess(action: Promise<boolean>) {
    if (await action) setOpenDialog(null)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${entryLabel}`}>
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
          {mergeCandidates.length > 0 && <DropdownMenuItem onSelect={() => showDialog('merge')}>Merge into…</DropdownMenuItem>}
          <DropdownMenuItem variant="destructive" onSelect={() => showDialog('delete')}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteEntryDialog
        open={openDialog === 'delete'}
        onOpenChange={(open) => showDialog(open ? 'delete' : null)}
        entryLabel={entryLabel}
        onConfirm={() => closeOnSuccess(deleteEntry(entryId))}
        busy={busy}
        errors={errors}
      />
      <MergeEntryDialog
        open={openDialog === 'merge'}
        onOpenChange={(open) => showDialog(open ? 'merge' : null)}
        entryLabel={entryLabel}
        candidates={mergeCandidates}
        onConfirm={(targetId) => closeOnSuccess(mergeEntries(targetId, entryId))}
        busy={busy}
        errors={errors}
      />
    </>
  )
}
