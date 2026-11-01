/**
 * Fills the gap between sending a chat message and the reply's first words with the shared
 * AI waiting line. Screen readers hear one steady "Preparing your reply…".
 */
import { AiWaitingLine } from '@/components/AiWaitingLine'

const waitingCaptions = [
  'Reading your message',
  'Thinking it through',
  'Pulling the details together',
  'Shaping a reply',
  'Still working on it. Careful answers can take a moment',
]

export function ChatReplyWaiting() {
  return <AiWaitingLine captions={waitingCaptions} statusLabel="Preparing your reply…" />
}
