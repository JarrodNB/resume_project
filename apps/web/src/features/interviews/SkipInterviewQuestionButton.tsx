/** Skip the rest of a core-question cycle, protecting any unsubmitted text or audio.
 * Input is cleared only after the server confirms a durable skip.
 */
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function SkipInterviewQuestionButton({ pending = false, dirty, disabled, busy, error, skip, onSkipped, onOpenChange }: {
  pending?: boolean; dirty: boolean; disabled: boolean; busy: boolean; error: string | null
  skip: () => Promise<boolean>; onSkipped: () => void; onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const confirming = useRef(false)
  function changeOpen(value: boolean) { setOpen(value); onOpenChange?.(value) }
  async function confirm() {
    if (confirming.current) return
    confirming.current = true
    try {
      if (await skip()) { onSkipped(); changeOpen(false) }
    } finally { confirming.current = false }
  }
  return <>
    <Button variant="outline" disabled={disabled || busy} onClick={() => {
      if (dirty) changeOpen(true)
      else void confirm()
    }}>{pending ? 'Retry skip' : 'Skip question'}</Button>
    <Dialog open={open} onOpenChange={(value) => { if (!busy) changeOpen(value) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Skip this question?</DialogTitle>
          <DialogDescription>Your unsubmitted answer and recording will be discarded. We’ll move to the next core question, with no more follow-ups for this one. Any answers already submitted stay saved.</DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button autoFocus variant="outline" disabled={busy} onClick={() => changeOpen(false)}>Keep answering</Button>
          <Button disabled={busy} onClick={() => void confirm()}>{busy ? 'Skipping…' : 'Skip and discard'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
