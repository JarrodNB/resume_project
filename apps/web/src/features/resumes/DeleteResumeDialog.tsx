/** Ask before permanently removing a saved resume; persistence stays in its hook. */
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function DeleteResumeDialog({ open, onOpenChange, onConfirm, pending, errors }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  pending: boolean
  errors: string[]
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete resume?</DialogTitle>
          <DialogDescription>
            This permanently deletes the resume and its saved sections. Your job and career
            library remain. You can write a new resume for the job later.
          </DialogDescription>
        </DialogHeader>
        <ErrorAlert title="Couldn't delete this resume" messages={errors} />
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" disabled={pending} onClick={onConfirm}>{pending ? 'Deleting…' : 'Delete'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
