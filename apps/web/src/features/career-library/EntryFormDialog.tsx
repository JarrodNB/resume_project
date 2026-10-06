/**
 * Description: Dialog shell for adding or editing one career library record.
 * Index:
 *   - EntryFormDialog: title, fields, save errors, and save/cancel
 */
import type { FormEvent, ReactNode } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface EntryFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  onSubmit: () => void
  busy: boolean
  errors: string[]
  children: ReactNode
}

/** Renders a save dialog. The caller closes it after a successful save. */
export function EntryFormDialog({ open, onOpenChange, title, description, onSubmit, busy, errors, children }: EntryFormDialogProps) {
  /** Submits the form without a full page reload. */
  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100%-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          {children}
          <ErrorAlert title="Couldn't save" messages={errors} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
