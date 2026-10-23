/** Confirms cancelling preparation or ending an active interview before clearing local audio. */
import { useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function AbandonInterviewButton({ busy, dirty, beforeStart = false, textDraft = false, error, abandon, onAbandoned }: {
  busy: boolean; dirty: boolean; beforeStart?: boolean; textDraft?: boolean; error: string | null; abandon: () => Promise<boolean>; onAbandoned: () => void
}) {
  const [open, setOpen] = useState(false)
  const confirming = useRef(false)
  const descriptionId = useId()
  const confirmLabel = beforeStart ? 'Confirm cancellation' : 'Confirm abandonment'
  const busyLabel = beforeStart ? 'Cancelling…' : 'Abandoning…'
  async function confirm() {
    if (confirming.current) return
    confirming.current = true
    try {
      if (await abandon()) { onAbandoned(); setOpen(false) }
    } finally { confirming.current = false }
  }
  return <>
    <Button className="justify-self-start" variant="outline" disabled={busy} onClick={() => setOpen(true)}>{beforeStart ? 'Cancel preparation' : 'Abandon interview'}</Button>
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value) }}>
      <DialogContent aria-describedby={beforeStart ? undefined : descriptionId}>
        <DialogHeader>
          <DialogTitle>{beforeStart ? 'Cancel this preparation?' : 'Abandon this interview?'}</DialogTitle>
          {!beforeStart && <DialogDescription id={descriptionId}>You cannot continue this interview afterward. Audio access ends and saved audio is queued for deletion. Existing provider charges are kept.{dirty && (textDraft ? ' Your unsubmitted answer and any recording will be discarded.' : ' Your unsubmitted recording will be discarded.')}</DialogDescription>}
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button autoFocus variant="outline" disabled={busy} onClick={() => setOpen(false)}>{beforeStart ? 'Keep preparation' : 'Keep interview'}</Button>
          <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>{busy ? busyLabel : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
