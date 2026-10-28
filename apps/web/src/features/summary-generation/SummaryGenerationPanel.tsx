/** Explicit missing-summary generation with editable review and durable task recovery. */
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { PROSE_TEXT } from '@/lib/textLimits'
import { useSummaryGeneration } from './useSummaryGeneration'

export function SummaryGenerationPanel({ targetKind, targetId, onAccepted }: {
  targetKind: string; targetId?: string; onAccepted?: () => void | Promise<unknown>
}) {
  const summary = useSummaryGeneration(targetKind, targetId, onAccepted)
  const task = summary.task
  const result = task?.result && typeof task.result === 'object' ? task.result as Record<string, unknown> : null
  const proposal = task?.status === 'COMPLETED' && !task.acceptedAt && typeof result?.text === 'string' ? result.text : null
  return <div className="grid gap-3">
    {summary.loading ? <p role="status" className="text-sm text-muted-foreground">Loading saved summary work…</p> : task?.acceptedAt ?
      <p role="status" className="text-sm">Summary saved.</p> : task?.status === 'QUEUED' ?
        <div className="flex flex-wrap items-center gap-3"><p role="status" className="text-sm text-muted-foreground">Generating your summary…</p><Button type="button" size="sm" variant="ghost" disabled={summary.saving} onClick={() => void summary.discard()}>Discard draft</Button></div> : proposal !== null ?
          <ProposalReview key={task?.id} text={proposal} disabled={summary.saving || summary.stale} onAccept={summary.accept} onDiscard={summary.discard} /> :
          <div className="flex flex-wrap items-center gap-3"><Button type="button" size="sm" variant="outline" disabled={summary.saving} onClick={() => void summary.generate()}>Generate summary</Button><p className="text-sm text-muted-foreground">Review a draft based on your saved career information before saving it.</p></div>}
    {summary.stale && !task?.acceptedAt && <div className="grid justify-items-start gap-2"><p role="status" className="text-sm">Your career information changed. Generate a new summary before accepting.</p><Button type="button" size="sm" variant="outline" disabled={summary.saving || task?.status === 'QUEUED'} onClick={() => void summary.generate()}>Generate new summary</Button></div>}
    {summary.errors.length > 0 && <div className="grid justify-items-start gap-2"><div role="alert" className="text-sm text-destructive">{summary.errors.map((error, i) => <p key={i}>{error}</p>)}</div><Button type="button" size="sm" variant="ghost" onClick={() => void summary.refresh()}>Refresh status</Button></div>}
  </div>
}

function ProposalReview({ text, disabled, onAccept, onDiscard }: { text: string; disabled: boolean; onAccept: (text: string) => Promise<void>; onDiscard: () => Promise<void> }) {
  const [draft, setDraft] = useState(text)
  const id = useId()
  return <div className="grid gap-3">
    <label htmlFor={id} className="text-sm font-medium">Proposed summary</label>
    <Textarea id={id} disabled={disabled} value={draft} onChange={(event) => setDraft(event.target.value)} rows={5} maxLength={PROSE_TEXT} />
    <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={disabled || !draft.trim()} onClick={() => void onAccept(draft)}>Accept summary</Button><Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => void onDiscard()}>Discard draft</Button></div>
  </div>
}
