/** Compose a career-chat message and distinguish temporary output from saved history. */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ErrorAlert } from '@/components/ErrorAlert'
import { chatFailureMessage, useChatTurn } from './useChatTurn'

export function ChatTurn({ conversationId, maxCharacters, onAccepted }: { conversationId: string; maxCharacters: number; onAccepted: () => void }) {
  const turn = useChatTurn(conversationId, onAccepted)
  const [draft, setDraft] = useState('')
  const length = Array.from(draft).length
  const oversized = length > maxCharacters
  const failed = turn.operation?.status === 'failed'
  const pendingMessage = turn.pending || failed ? turn.operation?.message : null

  async function send(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft.trim() || oversized || turn.busy || turn.pending) return
    if (await turn.send(draft)) setDraft('')
  }

  return <div className="grid min-w-0 gap-4">
    {pendingMessage && <div className="grid gap-2 border-t pt-4">
      <p className="text-sm font-bold">You</p>
      <p className="max-w-prose whitespace-pre-wrap break-words leading-relaxed">{pendingMessage}</p>
    </div>}
    {turn.pending && <div className="grid gap-2 border-l-2 border-border pl-4" aria-label="Reply in progress">
      <p className="text-sm font-bold">Careergrind <span className="font-normal text-muted-foreground">· Draft reply</span></p>
      <p role="status" className="text-sm text-muted-foreground">{turn.provisional ? 'Replying…' : 'Preparing your reply…'}</p>
      {turn.provisional && <p className="max-w-prose whitespace-pre-wrap break-words leading-relaxed">{turn.provisional}</p>}
    </div>}
    {failed && <div className="grid justify-items-start gap-2">
      <ErrorAlert title="Reply not saved" messages={[chatFailureMessage(turn.operation?.failureCode ?? null)]} />
      <Button variant="outline" disabled={turn.busy} onClick={() => void turn.retry()}>{turn.busy ? 'Retrying…' : 'Retry reply'}</Button>
    </div>}
    <ErrorAlert title="Couldn't send your message" messages={turn.errors} />
    {(turn.error || turn.liveError) && <div className="grid justify-items-start gap-2">
      <ErrorAlert title="Live status unavailable" messages={['Live updates are unavailable. Check the saved status to recover your latest reply.']} />
      <Button variant="outline" onClick={() => void turn.refetch().catch(() => undefined)}>Check saved status</Button>
    </div>}
    <form onSubmit={(event) => void send(event)} className="grid gap-2 border-t pt-4">
      <label htmlFor={`chat-message-${conversationId}`} className="text-sm font-bold">Your message</label>
      <Textarea id={`chat-message-${conversationId}`} value={draft} onChange={(event) => setDraft(event.target.value)}
        disabled={turn.busy || turn.pending} aria-invalid={oversized} aria-describedby={`chat-message-help-${conversationId}`}
        placeholder="What would you like to work through?" className="min-h-28" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p id={`chat-message-help-${conversationId}`} className={oversized ? 'text-sm text-destructive' : 'text-xs text-muted-foreground'}>
          {length.toLocaleString()} / {maxCharacters.toLocaleString()} characters{oversized ? ' — shorten your message before sending.' : ''}
        </p>
        <Button type="submit" disabled={!draft.trim() || oversized || turn.busy || turn.pending || !!turn.error || turn.checking}>{turn.busy ? 'Sending…' : 'Send message'}</Button>
      </div>
    </form>
  </div>
}
