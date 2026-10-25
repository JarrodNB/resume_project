/** Opens an inline, individual editing exchange without replacing the saved library text. */
import { useId, useState } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PROSE_TEXT } from '@/lib/textLimits'
import { LibraryAssessment } from './LibraryAssessment'
import { useLibraryEdit } from './useLibraryEdit'

interface Props {
  kind: string
  recordId: string
  currentText: string
  sourceRevision: string
  disabled?: boolean
}

export function LibraryEditControl(props: Props) {
  const [open, setOpen] = useState(false)
  return <div className="mt-2">
    {open ? <LibraryEditPanel {...props} onClose={() => setOpen(false)} /> :
      <Button size="sm" variant="ghost" disabled={props.disabled} onClick={() => setOpen(true)}>Improve with AI</Button>}
  </div>
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function LibraryEditPanel({ kind, recordId, currentText, sourceRevision, onClose }: Props & { onClose: () => void }) {
  const edit = useLibraryEdit(kind, recordId, sourceRevision)
  const [feedback, setFeedback] = useState('')
  const [startingAnother, setStartingAnother] = useState(false)
  const feedbackId = useId()
  const task = startingAnother && edit.task?.acceptedAt ? undefined : edit.task
  const stale = !startingAnother && edit.stale
  const proposal = object(task?.result)
  const questions = Array.isArray(task?.pendingQuestions) ? task.pendingQuestions : []
  const question = object(questions[0]).question
  const accepted = !!task?.acceptedAt
  const hasProposal = task?.status === 'COMPLETED' && typeof proposal.text === 'string'
  const label = typeof question === 'string' ? 'Your answer' : task ? 'What should change?' : 'What would you like to improve? (optional)'

  async function submit(skip = false, fresh = false) {
    if (await edit.submit(skip ? '' : feedback, skip, fresh || startingAnother)) {
      setFeedback('')
      setStartingAnother(false)
    }
  }

  return <section aria-label="Improve this career detail" className="grid gap-3 border-t pt-3 text-sm">
    <div className="flex items-center justify-between gap-3">
      <p className="font-medium">Improve with AI</p>
      <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
    </div>
    <ErrorAlert title="Could not complete this edit" messages={edit.errors} />
    {edit.loading ? <p className="text-muted-foreground" role="status">Loading saved edit…</p> : accepted ?
      <><p role="status">Saved to your library.</p><Button size="sm" variant="outline" className="justify-self-start" onClick={() => setStartingAnother(true)}>Start another edit</Button></> : <>
      {stale && <p role="status">This entry changed. Start a new edit from its current text.</p>}
      {task?.status === 'QUEUED' && <p role="status">Working on this detail…</p>}
      {hasProposal && <div className="grid gap-3">
        <div><p className="mb-1 text-xs font-medium text-muted-foreground">Current text</p><p className="whitespace-pre-wrap">{currentText}</p></div>
        <div><p className="mb-1 text-xs font-medium text-muted-foreground">Proposed revision</p><p className="whitespace-pre-wrap">{String(proposal.text)}</p></div>
        <LibraryAssessment assessment={{ kind, recordId, field: '', color: String(proposal.color), reason: String(proposal.reason), stale }} />
        <Button className="justify-self-start" size="sm" disabled={edit.busy || stale} onClick={() => void edit.save()}>Accept revision</Button>
      </div>}
      {typeof question === 'string' && !stale && <p className="font-medium">{question}</p>}
      <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); void submit(false, stale) }}>
        <Label htmlFor={feedbackId}>{label}</Label>
        <Textarea id={feedbackId} value={feedback} onChange={(event) => setFeedback(event.target.value)} maxLength={PROSE_TEXT} disabled={edit.busy} rows={3} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" type="submit" disabled={edit.busy || (!!task && !stale && !feedback.trim())}>
            {stale ? 'Start from current text' : task?.status === 'NEEDS_USER_INPUT' ? 'Send answer' : task ? 'Revise again' : 'Generate revision'}
          </Button>
          {task?.status === 'NEEDS_USER_INPUT' && !stale && <Button size="sm" type="button" variant="outline" disabled={edit.busy} onClick={() => void submit(true)}>Skip question</Button>}
          {task && <Button size="sm" type="button" variant="ghost" disabled={edit.loading} onClick={() => void edit.closeDraft().then((closed) => { if (closed) onClose() })}>Discard draft</Button>}
        </div>
      </form>
    </>}
  </section>
}
