/** An accessible, undoable thumbs-down toggle for an accepted assistant reply only. */
import { useId } from 'react'
import { ThumbsDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChatMessageFeedback } from './useChatMessageFeedback'

export function ChatReplyFeedback({ conversationId, messageId, thumbsDown }: { conversationId: string; messageId: string; thumbsDown: boolean }) {
  const feedback = useChatMessageFeedback(conversationId, messageId, thumbsDown)
  const errorId = useId()
  return <div className="grid justify-items-start gap-2">
    <Button type="button" variant="ghost" size="sm" aria-label="Thumbs down" aria-pressed={feedback.saved}
      aria-describedby={feedback.errors.length ? errorId : undefined} aria-busy={feedback.loading}
      title={feedback.saved ? 'Remove thumbs down' : 'Mark this reply unhelpful'}
      className="aria-pressed:bg-muted" disabled={feedback.loading} onClick={() => void feedback.toggle()}>
      <ThumbsDown aria-hidden />{feedback.loading ? 'Saving…' : 'Thumbs down'}
    </Button>
    {feedback.errors.length > 0 && <p id={errorId} role="alert" className="text-sm text-destructive">{feedback.errors.join(' ')}</p>}
  </div>
}
