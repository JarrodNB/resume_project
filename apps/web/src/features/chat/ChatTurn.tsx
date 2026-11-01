/**
 * Shows a chat's messages in a scrolling area with the message box pinned below it.
 * Temporary reply text is marked as live until it is saved. Which design option draws it
 * (rows, a line of stops, or bubbles) is decided by CSS from the page's layout setting.
 * Assistant replies are drawn as Markdown; the user's own words stay plain text.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { SendHorizontal } from 'lucide-react'
import { ChatMarkdown } from './ChatMarkdown'
import { ChatReplyFeedback } from './ChatReplyFeedback'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ErrorAlert } from '@/components/ErrorAlert'
import { chatFailureMessage, useChatTurn } from './useChatTurn'

type SavedMessage = { id: string; role: string; content: string; thumbsDown: boolean; thumbsUp: boolean }

export function ChatTurn({ conversationId, maxCharacters, onAccepted, messages = [], earlier }: { conversationId: string; maxCharacters: number; onAccepted: () => void | Promise<void>; messages?: SavedMessage[]; earlier?: ReactNode }) {
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

  const scroller = useRef<HTMLDivElement>(null)
  const followLatest = useRef(true)
  // Keep the newest words in view, unless the reader scrolled up to look at something earlier.
  useEffect(() => {
    const element = scroller.current
    if (element && followLatest.current) element.scrollTop = element.scrollHeight
  }, [messages.length, turn.provisional, pendingMessage, turn.pending, failed])

  return <div className="chat-turn">
    <div ref={scroller} role="region" aria-label="Messages" tabIndex={0} className="chat-scroll"
      onScroll={(event) => {
        const element = event.currentTarget
        followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96
      }}>
      {earlier}
      {messages.length === 0 && !pendingMessage && <p className="chat-empty">This chat is ready for your first message.</p>}
      <ol className="chat-messages">
        {messages.map((message) => <li key={message.id} className="chat-message" data-role={message.role === 'user' ? 'user' : 'assistant'}>
          <p className="chat-speaker">{message.role === 'user' ? 'You' : 'Careergrind'}</p>
          {message.role === 'user' ? <p className="chat-text">{message.content}</p> : <ChatMarkdown content={message.content} />}
          {message.role === 'assistant' && <ChatReplyFeedback conversationId={conversationId} messageId={message.id} thumbsDown={message.thumbsDown} thumbsUp={message.thumbsUp} />}
        </li>)}
        {pendingMessage && <li className="chat-message" data-role="user">
          <p className="chat-speaker">You</p>
          <p className="chat-text">{pendingMessage}</p>
        </li>}
        {(turn.pending || handingOff) && <li className="chat-message is-live" data-role="assistant" aria-label="Reply in progress">
          <div className="chat-speaker-row">
            <p className="chat-speaker">Careergrind</p>
            {turn.pending && <p role="status" className="chat-status">
              <span aria-hidden="true" className="chat-writing-dot" />
              {turn.provisional ? 'Writing reply…' : 'Preparing your reply…'}
            </p>}
          </div>
          {turn.provisional && <ChatMarkdown content={turn.provisional}>{turn.pending && <span aria-hidden="true" className="chat-writing-cursor" />}</ChatMarkdown>}
        </li>}
      </ol>
      {refreshError && <div className="chat-alert">
        <ErrorAlert title="Couldn't load the saved reply" messages={['The reply was saved, but the conversation could not refresh.']} />
        <Button variant="outline" onClick={() => { if (turn.operation) refreshHistory(turn.operation.id) }}>Retry loading reply</Button>
      </div>}
      {failed && <div className="chat-alert">
        <ErrorAlert title="Reply not saved" messages={[chatFailureMessage(turn.operation?.failureCode ?? null)]} />
        <Button variant="outline" disabled={turn.busy} onClick={() => void turn.retry()}>{turn.busy ? 'Retrying…' : 'Retry reply'}</Button>
      </div>}
      <ErrorAlert title="Couldn't send your message" messages={turn.errors} />
      {(turn.error || turn.liveError) && <div className="chat-alert">
        <ErrorAlert title="Live status unavailable" messages={['Live updates are unavailable. Check the saved status to recover your latest reply.']} />
        <Button variant="outline" onClick={() => void turn.refetch().catch(() => undefined)}>Check saved status</Button>
      </div>}
    </div>
    <form onSubmit={(event) => void send(event)} className="chat-composer">
      <label htmlFor={`chat-message-${conversationId}`} className="sr-only">Your message</label>
      <Textarea id={`chat-message-${conversationId}`} value={draft} onChange={(event) => setDraft(event.target.value)}
        disabled={turn.busy || turn.pending} aria-invalid={oversized} aria-describedby={`chat-message-help-${conversationId}`}
        placeholder="What would you like to work through?" className="chat-input" />
      <div className="chat-composer-foot">
        <p id={`chat-message-help-${conversationId}`} className={oversized ? 'text-sm text-destructive' : 'text-xs text-muted-foreground'}>
          {length.toLocaleString()} / {maxCharacters.toLocaleString()} characters{oversized ? ' — shorten your message before sending.' : ''}
        </p>
        <Button type="submit" disabled={!draft.trim() || oversized || turn.busy || turn.pending || !!turn.error || turn.checking}><SendHorizontal aria-hidden />{turn.busy ? 'Sending…' : 'Send message'}</Button>
      </div>
    </form>
  </div>
}
