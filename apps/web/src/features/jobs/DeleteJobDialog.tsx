/**
 * Description: Confirmation dialog for deleting a saved job.
 * Index:
 *   - DeleteJobDialog: asks before deleting; shows errors from the attempt
 */
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface DeleteJobDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobTitle: string
  onConfirm: () => void
  busy: boolean
  errors: string[]
}

/** Asks before the job is removed. Answers go with it; a tailored resume stays, unlinked. */
export function DeleteJobDialog({ open, onOpenChange, jobTitle, onConfirm, busy, errors }: DeleteJobDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {jobTitle}?</DialogTitle>
          <DialogDescription>
            This removes the job. Answers saved for it go with it. A tailored resume written for it stays, unlinked.
          </DialogDescription>
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
