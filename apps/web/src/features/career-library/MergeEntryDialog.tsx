/**
 * Description: Dialog for merging a career library entry into another entry of the same kind.
 * Index:
 *   - MergeCandidate: an entry that can be picked as the merge target
 *   - MergeEntryDialog: lists the candidates as radio options and confirms the merge
 */
import { useState } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

export interface MergeCandidate {
  id: string
  label: string
}

interface MergeEntryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entryLabel: string
  candidates: MergeCandidate[]
  onConfirm: (targetId: string) => void
  busy: boolean
  errors: string[]
}

/** Renders the merge picker; the merge button is enabled once a target is chosen. */
export function MergeEntryDialog({ open, onOpenChange, entryLabel, candidates, onConfirm, busy, errors }: MergeEntryDialogProps) {
  const [targetId, setTargetId] = useState('')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge {entryLabel} into…</DialogTitle>
          <DialogDescription>
            Missing details and new bullet points from this entry are added to the one you pick; this entry is then
            removed.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup value={targetId} onValueChange={setTargetId} aria-label="Merge target">
          {candidates.map((candidate) => (
            <div key={candidate.id} className="flex items-center gap-2">
              <RadioGroupItem value={candidate.id} id={`merge-target-${candidate.id}`} />
              <Label htmlFor={`merge-target-${candidate.id}`}>{candidate.label}</Label>
            </div>
          ))}
        </RadioGroup>
        <ErrorAlert messages={errors} title="Couldn't merge" />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={() => onConfirm(targetId)} disabled={busy || !targetId}>
            {busy ? 'Merging…' : 'Merge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
