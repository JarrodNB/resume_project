/** Confirms the permanent end of an unfinished interview before clearing local audio. */
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function AbandonInterviewButton({ busy, dirty, error, abandon, onAbandoned }: {
  busy: boolean; dirty: boolean; error: string | null; abandon: () => Promise<boolean>; onAbandoned: () => void
}) {
  const [open, setOpen] = useState(false)
  const confirming = useRef(false)
  async function confirm() {
    if (confirming.current) return
    confirming.current = true
    try {
      if (await abandon()) { onAbandoned(); setOpen(false) }
    } finally { confirming.current = false }
  }
  return <>
    <Button className="justify-self-start" variant="outline" disabled={busy} onClick={() => setOpen(true)}>Abandon interview</Button>
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Abandon this interview?</DialogTitle>
          <DialogDescription>You cannot continue this interview afterward. Audio access ends and saved audio is queued for deletion. Existing provider charges are kept.{dirty && ' Your unsubmitted recording will be discarded.'}</DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button autoFocus variant="outline" disabled={busy} onClick={() => setOpen(false)}>Keep interview</Button>
          <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>{busy ? 'Abandoning…' : 'Confirm abandonment'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
