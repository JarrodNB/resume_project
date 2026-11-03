/**
 * Description: Dismiss an unfinished generation request without exposing internal question batches.
 * Index: DismissQuestionGenerationButton
 */
import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useDeleteInterviewSet } from './useInterviewPrep'

/** Keeps the request visible until confirmed dismissal succeeds. */
export function DismissQuestionGenerationButton({ id, onDeleted }: { id: string; onDeleted: () => unknown }) {
  const [open, setOpen] = useState(false)
  const { remove, loading, errors } = useDeleteInterviewSet(id)
  /** Closes confirmation and refreshes/navigates only after successful deletion. */
  async function confirm() {
    if (await remove()) {
      setOpen(false)
      await Promise.resolve(onDeleted()).catch(() => { /* Owning queries report refresh errors. */ })
    }
  }
  return <>
    <Button variant="outline" size="sm" aria-label="Dismiss question generation" onClick={() => setOpen(true)}><Trash2 aria-hidden="true" />Dismiss</Button>
    <Dialog open={open} onOpenChange={(value) => { if (!loading) setOpen(value) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dismiss this request?</DialogTitle>
          <DialogDescription>This removes this question generation request. You can get new questions whenever you are ready.</DialogDescription>
        </DialogHeader>
        <ErrorAlert title="Couldn't dismiss this request" messages={errors} />
        <DialogFooter>
          <DialogClose asChild><Button variant="outline" disabled={loading}>Cancel</Button></DialogClose>
          <Button variant="destructive" disabled={loading} onClick={() => void confirm()}>{loading ? 'Dismissing…' : 'Dismiss'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
