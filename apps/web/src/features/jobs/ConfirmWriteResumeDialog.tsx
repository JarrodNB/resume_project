/**
 * Description: Confirmation before writing a resume when this job has not been compared
 * with the career library.
 * Index:
 *   - ConfirmWriteResumeDialog: recommends a comparison, or continues to writing
 */
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface ConfirmWriteResumeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onWriteAnyway: () => void
  onCompare: () => void
  busy: boolean
}

/** Recommends comparing the job first. Compare first starts the comparison and stays on the page; writing continues to tailoring. */
export function ConfirmWriteResumeDialog({ open, onOpenChange, onWriteAnyway, onCompare, busy }: ConfirmWriteResumeDialogProps) {
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
          <Button variant="outline" disabled={busy} onClick={onCompare}>Compare first</Button>
          <Button disabled={busy} onClick={onWriteAnyway}>Write resume anyway</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
