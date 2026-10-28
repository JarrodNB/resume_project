/**
 * Description: Confirmation dialog for archiving a saved job.
 * Index:
 *   - ArchiveJobDialog: asks before archiving; shows errors from the attempt
 */
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface ArchiveJobDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobTitle: string
  onConfirm: () => void
  busy: boolean
  errors: string[]
}

/** Asks before the job is hidden. All saved answers and linked records are kept. */
export function ArchiveJobDialog({ open, onOpenChange, jobTitle, onConfirm, busy, errors }: ArchiveJobDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive {jobTitle}?</DialogTitle>
          <DialogDescription>
            This hides the job from your saved jobs and Home. Your answers, resumes, and interview history are kept.
          </DialogDescription>
        </DialogHeader>
        <ErrorAlert messages={errors} title="Couldn't archive" />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={onConfirm} disabled={busy}>
            {busy ? 'Archiving…' : 'Archive'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
