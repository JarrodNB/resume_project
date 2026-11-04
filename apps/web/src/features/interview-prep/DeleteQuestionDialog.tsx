/** Confirms deletion of one practice question in both the bank and answer editor. */
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useDeleteQuestion } from './useDeleteQuestion'

export function DeleteQuestionDialog({ setId, questionId, questionText, dirty = false, open, onOpenChange, onDeleted }: {
  setId: string; questionId: string; questionText: string; dirty?: boolean; open: boolean; onOpenChange: (open: boolean) => void; onDeleted?: () => void
}) {
  const deletion = useDeleteQuestion(setId, questionId)
  async function confirm() {
    if (await deletion.remove()) {
      onOpenChange(false)
      onDeleted?.()
    }
  }
  return <Dialog open={open} onOpenChange={(value) => { if (!deletion.loading) onOpenChange(value) }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Delete this question?</DialogTitle>
        <DialogDescription>This permanently removes “{questionText}”, its saved answer, and feedback. Other questions are kept.{dirty ? ' Your unsaved answer will also be lost.' : ''}</DialogDescription>
      </DialogHeader>
      <ErrorAlert title="Couldn't delete question" messages={deletion.errors} />
      <DialogFooter>
        <DialogClose asChild><Button variant="outline" disabled={deletion.loading}>Cancel</Button></DialogClose>
        <Button variant="destructive" disabled={deletion.loading} onClick={() => void confirm()}>{deletion.loading ? 'Deleting…' : 'Delete question'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
