/** Compose a career-chat message and distinguish temporary output from saved history. */
import { useState } from 'react'
import { ChatReplyFeedback } from './ChatReplyFeedback'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ErrorAlert } from '@/components/ErrorAlert'
import { chatFailureMessage, useChatTurn } from './useChatTurn'

type SavedMessage = { id: string; role: string; content: string; thumbsDown: boolean; thumbsUp: boolean }

export function ChatTurn({ conversationId, maxCharacters, onAccepted, messages = [] }: { conversationId: string; maxCharacters: number; onAccepted: () => void | Promise<void>; messages?: SavedMessage[] }) {
  const [refreshedOperation, setRefreshedOperation] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState(false)
  function refreshHistory(id: string) {
    setRefreshError(false)
    Promise.resolve().then(onAccepted).then(() => setRefreshedOperation(id)).catch(() => setRefreshError(true))
  }
  const turn = useChatTurn(conversationId, (id) => {
    refreshHistory(id)
  })
  const [draft, setDraft] = useState('')
  const length = Array.from(draft).length
  const oversized = length > maxCharacters
  const failed = turn.operation?.status === 'failed'
  const handingOff = turn.operation?.status === 'accepted' && !!turn.provisional && refreshedOperation !== turn.operation.id
  const pendingMessage = turn.pending || failed || handingOff ? turn.operation?.message : null

  async function send(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft.trim() || oversized || turn.busy || turn.pending) return
    if (await turn.send(draft)) setDraft('')
  }

  return <div className="grid min-w-0 gap-4">
    {messages.length === 0 && !pendingMessage && <p className="py-8 text-muted-foreground">This chat is ready for your first message.</p>}
    <ol className="grid gap-6">
      {messages.map((message) => <li key={message.id} className="grid gap-2 border-b pb-6 last:border-0">
        <p className="text-sm font-bold">{message.role === 'user' ? 'You' : 'Careergrind'}</p>
        <p className="max-w-prose whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
        {message.role === 'assistant' && <ChatReplyFeedback conversationId={conversationId} messageId={message.id} thumbsDown={message.thumbsDown} thumbsUp={message.thumbsUp} />}
      </li>)}
      {pendingMessage && <li className="grid gap-2 border-b pb-6">
        <p className="text-sm font-bold">You</p>
        <p className="max-w-prose whitespace-pre-wrap break-words leading-relaxed">{pendingMessage}</p>
      </li>}
      {(turn.pending || handingOff) && <li className="grid gap-2 border-b pb-6 last:border-0" aria-label="Reply in progress">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-sm font-bold">Careergrind</p>
          {turn.pending && <p role="status" className="inline-flex items-center gap-2 text-sm text-signal-ai-text">
            <span aria-hidden="true" className="chat-writing-dot" />
            {turn.provisional ? 'Writing reply…' : 'Preparing your reply…'}
          </p>}
        </div>
        {turn.provisional && <p className="max-w-prose whitespace-pre-wrap break-words leading-relaxed">{turn.provisional}{turn.pending && <span aria-hidden="true" className="chat-writing-cursor" />}</p>}
      </li>}
    </ol>
    {refreshError && <div className="grid justify-items-start gap-2">
      <ErrorAlert title="Couldn't load the saved reply" messages={['The reply was saved, but the conversation could not refresh.']} />
      <Button variant="outline" onClick={() => { if (turn.operation) refreshHistory(turn.operation.id) }}>Retry loading reply</Button>
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
