/**
 * Description: Confirmation dialog for deleting a career library entry.
 * Index:
 *   - DeleteEntryDialog: asks before deleting `entryLabel`; shows errors from the attempt
 */
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface DeleteEntryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entryLabel: string
  onConfirm: () => void
  busy: boolean
  errors: string[]
}

/** Renders the delete confirmation. */
export function DeleteEntryDialog({ open, onOpenChange, entryLabel, onConfirm, busy, errors }: DeleteEntryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {entryLabel}?</DialogTitle>
          <DialogDescription>This removes it from your career library. Tailored resumes keep their copy.</DialogDescription>
        </DialogHeader>
        <ErrorAlert messages={errors} title="Couldn't delete" />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
