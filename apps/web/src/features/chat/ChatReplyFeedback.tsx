/** An accessible, undoable feedback controls for an accepted assistant reply only. */
import { useId } from 'react'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChatMessageFeedback } from './useChatMessageFeedback'

export function ChatReplyFeedback({ conversationId, messageId, thumbsDown, thumbsUp }: { conversationId: string; messageId: string; thumbsDown: boolean; thumbsUp: boolean }) {
  const feedback = useChatMessageFeedback(conversationId, messageId, thumbsDown, thumbsUp)
  const errorId = useId()
  return <div className="grid justify-items-start gap-2">
    <div className="flex flex-wrap gap-1">
    <Button type="button" variant="ghost" size="sm" aria-label="Thumbs up" aria-pressed={feedback.saved.up}
      aria-describedby={feedback.errors.length ? errorId : undefined} aria-busy={feedback.loading}
      title={feedback.saved.up ? 'Remove thumbs up' : 'Mark this reply helpful'}
      className="aria-pressed:bg-muted" disabled={feedback.loading} onClick={() => void feedback.toggle('up')}>
      <ThumbsUp aria-hidden />Thumbs up
    </Button>
    <Button type="button" variant="ghost" size="sm" aria-label="Thumbs down" aria-pressed={feedback.saved.down}
      aria-describedby={feedback.errors.length ? errorId : undefined} aria-busy={feedback.loading}
      title={feedback.saved.down ? 'Remove thumbs down' : 'Mark this reply unhelpful'}
      className="aria-pressed:bg-muted" disabled={feedback.loading} onClick={() => void feedback.toggle('down')}>
      <ThumbsDown aria-hidden />{feedback.loading ? 'Saving…' : 'Thumbs down'}
    </Button>
    </div>
    {feedback.errors.length > 0 && <p id={errorId} role="alert" className="text-sm text-destructive">{feedback.errors.join(' ')}</p>}
  </div>
}
