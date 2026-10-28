/**
 * Description: Confirmation dialog for emptying the career library.
 * Index:
 *   - ClearLibraryDialog: asks before deleting every entry; shows errors from the attempt
 */
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface ClearLibraryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  busy: boolean
  errors: string[]
}

/** Asks before the library is emptied. Saved jobs and tailored resumes stay. */
export function ClearLibraryDialog({ open, onOpenChange, onConfirm, busy, errors }: ClearLibraryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete everything in your career library?</DialogTitle>
          <DialogDescription>
            This clears the profile on this page and removes every role, project, education, certification, skill, and career context entry, so a new
            resume import starts fresh. Saved jobs and tailored resumes stay.
          </DialogDescription>
        </DialogHeader>
        <ErrorAlert messages={errors} title="Couldn't delete" />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete all'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
