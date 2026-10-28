/**
 * Shows the user's saved chats so they can reopen one.
 *
 * It only reads the list the page already loaded, and it never deletes or renames chats.
 */
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import type { useChatWorkspace } from './useChatWorkspace'

type Workspace = ReturnType<typeof useChatWorkspace>

const dateLabel = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

export function ChatConversationList({ workspace, activeId }: { workspace: Workspace; activeId?: string }) {
  return <nav aria-label="Saved chats" className="chat-rail">
    <p className="chat-rail-title">Saved chats</p>
    {workspace.loading && !workspace.conversations && <p role="status" className="chat-rail-note">Loading chats…</p>}
    {workspace.conversations?.length === 0 && <p className="chat-rail-note">No saved chats yet. Start one when you’re ready.</p>}
    <ul>
      {workspace.conversations?.map((conversation) => <li key={conversation.id}>
        <Link to={`/chat/${conversation.id}`} aria-current={conversation.id === activeId ? 'page' : undefined} className="chat-rail-row">
          <span className="chat-rail-stop" aria-hidden="true" />
          <span className="chat-rail-name">
            <span className="chat-rail-title-text">{conversation.title}</span>
            <time dateTime={conversation.createdAt}>{dateLabel(conversation.createdAt)}</time>
          </span>
        </Link>
      </li>)}
    </ul>
    {workspace.nextCursor && <Button variant="outline" className="chat-rail-more" disabled={workspace.loadingMore} onClick={() => void workspace.loadMore()}>
      {workspace.loadingMore ? 'Loading…' : 'Load older chats'}
    </Button>}
  </nav>
}
