/** Copy one accepted answer into the career library after an editable preview.
 * Pair only retained saved dialogue, never drafts or interviewer acknowledgements.
 * The copy has its own lifetime; saving does not change interview state or references.
 */
import { useState } from 'react'
import type { InterviewSnapshotFragment } from '@/graphql/generated/graphql'
import { Button } from '@/components/ui/button'
import { CareerContextFormDialog } from '@/features/career-library/CareerContextFormDialog'

type InterviewMessage = InterviewSnapshotFragment['messages'][number]

export function SaveInterviewAnswer({ interview, message, onPreviewOpenChange }: { interview: InterviewSnapshotFragment; message: InterviewMessage; onPreviewOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  if (message.kind !== 'answer' || !retained(message.content)) return null
  const prompt = interview.messages
    .filter((item) => item.questionId === message.questionId && item.position < message.position && ['opening', 'follow_up'].includes(item.kind))
    .toSorted((a, b) => b.position - a.position)[0]
  if (!prompt || !retained(prompt.content)) return null

  function changeOpen(next: boolean) {
    setOpen(next)
    onPreviewOpenChange?.(next)
  }

  return <div className="grid justify-items-start gap-1">
    <Button type="button" variant="outline" size="sm" onClick={() => changeOpen(true)}>Save to Career context</Button>
    {saved && <p role="status" className="text-sm text-muted-foreground">Saved to Career context.</p>}
    <CareerContextFormDialog open={open} onOpenChange={changeOpen} context={null}
      initialValues={{ requirement: prompt.content, response: message.content }} onSaved={() => setSaved(true)} />
  </div>
}

function retained(text: string) {
  return Boolean(text.trim()) && text.trim() !== '[expired]'
}
