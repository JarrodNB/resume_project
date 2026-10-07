/**
 * Description: Confirmation before writing a resume when this job has not been compared
 * with the career library.
 * Index:
 *   - ConfirmWriteResumeDialog: recommends a comparison, or continues to writing
 */
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface ConfirmWriteResumeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onWriteAnyway: () => void
}

/** Recommends comparing the job first. Compare first stays on the page; writing continues to tailoring. */
export function ConfirmWriteResumeDialog({ open, onOpenChange, onWriteAnyway }: ConfirmWriteResumeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Compare this job first?</DialogTitle>
          <DialogDescription>
            Comparing it with your career library first usually makes a stronger resume. You can still write one now.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Compare first</Button>
          </DialogClose>
          <Button onClick={onWriteAnyway}>Write resume anyway</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
