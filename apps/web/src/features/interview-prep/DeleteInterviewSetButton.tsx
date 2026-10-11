/**
 * Description: Confirmed deletion of an interview set, including pending and failed sets.
 * Index: DeleteInterviewSetButton
 */
import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useDeleteInterviewSet } from './useInterviewPrep'

/** Keeps the set visible until confirmed deletion succeeds. */
export function DeleteInterviewSetButton({ id, number, onDeleted }: { id: string; number: number; onDeleted: () => unknown }) {
  const [open, setOpen] = useState(false)
  const { remove, loading, errors } = useDeleteInterviewSet(id)
  /** Closes confirmation and refreshes/navigates only after successful deletion. */
  async function confirm() {
    if (await remove()) {
      setOpen(false)
      void onDeleted()
    }
  }
  return <>
    <Button variant="outline" size="sm" aria-label={`Delete set ${number}`} onClick={() => setOpen(true)}><Trash2 aria-hidden="true" />Delete</Button>
    <Dialog open={open} onOpenChange={(value) => { if (!loading) setOpen(value) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete set {number}?</DialogTitle>
          <DialogDescription>This permanently removes the set, its questions, and any saved answers and feedback.</DialogDescription>
        </DialogHeader>
        <ErrorAlert title="Couldn't delete this set" messages={errors} />
        <DialogFooter>
          <DialogClose asChild><Button variant="outline" disabled={loading}>Cancel</Button></DialogClose>
          <Button variant="destructive" disabled={loading} onClick={() => void confirm()}>{loading ? 'Deleting…' : 'Delete'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
