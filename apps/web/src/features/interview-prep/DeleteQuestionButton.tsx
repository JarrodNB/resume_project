/** Lets a question bank row be deleted without opening the answer editor. */
import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DeleteQuestionDialog } from './DeleteQuestionDialog'

export function DeleteQuestionButton({ setId, questionId, questionText, disabled }: {
  setId: string; questionId: string; questionText: string; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  return <>
    <Button variant="ghost" size="icon-sm" disabled={disabled} aria-label={`Delete question: ${questionText}`} onClick={() => setOpen(true)}><Trash2 aria-hidden="true" /></Button>
    <DeleteQuestionDialog setId={setId} questionId={questionId} questionText={questionText} open={open} onOpenChange={setOpen} />
  </>
}
