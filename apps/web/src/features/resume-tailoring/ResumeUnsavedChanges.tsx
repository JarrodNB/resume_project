/** Warn before leaving a resume with unsaved work. Staying keeps the editor intact;
 * leaving explicitly discards local edits. Reloads use the browser's native warning.
 */
import { useCallback, useEffect } from 'react'
import { useBeforeUnload, useBlocker } from 'react-router'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function ResumeUnsavedChanges({ dirty }: { dirty: boolean }) {
  const blocker = useBlocker(dirty)
  useEffect(() => {
    if (!dirty && blocker.state === 'blocked') blocker.reset()
  }, [dirty, blocker])
  useBeforeUnload(useCallback((event) => {
    if (dirty) {
      event.preventDefault()
      event.returnValue = ''
    }
  }, [dirty]))

  return (
    <Dialog open={blocker.state === 'blocked'} onOpenChange={(open) => {
      if (!open && blocker.state === 'blocked') blocker.reset()
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leave without saving?</DialogTitle>
          <DialogDescription>Your resume has unsaved changes. Leaving this page will discard them.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => { if (blocker.state === 'blocked') blocker.proceed() }}>Discard and leave</Button>
          <Button autoFocus onClick={() => { if (blocker.state === 'blocked') blocker.reset() }}>Keep editing</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
