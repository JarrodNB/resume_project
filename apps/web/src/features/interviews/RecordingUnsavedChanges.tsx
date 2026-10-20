/** Warn before browser-memory audio is lost. Confirmed navigation unmounts the
 * recorder and preview, which release their microphone tracks and private URLs.
 */
import { useEffect } from 'react'
import { useBeforeUnload, useBlocker } from 'react-router'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function RecordingUnsavedChanges({ dirty }: { dirty: boolean }) {
  const blocker = useBlocker(dirty)
  useBeforeUnload((event) => {
    if (dirty) { event.preventDefault(); event.returnValue = '' }
  })
  useEffect(() => {
    if (!dirty && blocker.state === 'blocked') blocker.reset()
  }, [dirty, blocker])
  return <Dialog open={blocker.state === 'blocked'} onOpenChange={(open) => {
    if (!open && blocker.state === 'blocked') blocker.reset()
  }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Leave without submitting?</DialogTitle>
        <DialogDescription>Your recording is only in browser memory. Leaving will discard it.</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={() => { if (blocker.state === 'blocked') blocker.proceed() }}>Discard and leave</Button>
        <Button autoFocus onClick={() => { if (blocker.state === 'blocked') blocker.reset() }}>Keep reviewing</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
