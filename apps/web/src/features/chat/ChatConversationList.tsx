/**
 * Shows the user's saved chats so they can reopen one.
 *
 * Timetable and Desk draw a side list; The Line folds the same links into a menu. It only
 * reads the list the page already loaded, and it never deletes or renames chats.
 */
import { Link } from 'react-router'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { ChatLayout } from './chatLayouts'
import type { useChatWorkspace } from './useChatWorkspace'

type Workspace = ReturnType<typeof useChatWorkspace>

const dayLabel = (value: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value))
const timeLabel = (value: string) => new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(value))
const fullLabel = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

type ListProps = { workspace: Workspace; activeId?: string; layout: ChatLayout; search: string }

export function ChatConversationList({ workspace, activeId, layout, search }: ListProps) {
  if (layout === 'line') return <ChatSwitcher workspace={workspace} activeId={activeId} search={search} />
  return <nav aria-label="Saved chats" className="chat-rail">
    {layout === 'timetable' && <div className="chat-rail-head" aria-hidden="true"><span>Started</span><span>Chat</span></div>}
    {layout === 'desk' && <p className="chat-rail-title">Saved chats</p>}
    {workspace.loading && !workspace.conversations && <p role="status" className="chat-rail-note">Loading chats…</p>}
    {workspace.conversations?.length === 0 && <p className="chat-rail-note">No saved chats yet. Start one when you’re ready.</p>}
    <ul>
      {workspace.conversations?.map((conversation) => <li key={conversation.id}>
        <Link to={{ pathname: `/chat/${conversation.id}`, search }} aria-current={conversation.id === activeId ? 'page' : undefined} className="chat-rail-row">
          {layout === 'timetable'
            ? <time dateTime={conversation.createdAt}><b>{dayLabel(conversation.createdAt)}</b><span>{timeLabel(conversation.createdAt)}</span></time>
            : <span className="chat-rail-stop" aria-hidden="true" />}
          <span className="chat-rail-name">
            <span className="chat-rail-title-text">{conversation.title}</span>
            {layout === 'desk' && <time dateTime={conversation.createdAt}>{fullLabel(conversation.createdAt)}</time>}
          </span>
        </Link>
      </li>)}
    </ul>
    {workspace.nextCursor && <Button variant="outline" className="chat-rail-more" disabled={workspace.loadingMore} onClick={() => void workspace.loadMore()}>
      {workspace.loadingMore ? 'Loading…' : 'Load older chats'}
    </Button>}
  </nav>
}

/** The Line keeps the page to one conversation, so the other chats sit behind a menu. */
function ChatSwitcher({ workspace, activeId, search }: Omit<ListProps, 'layout'>) {
  const active = workspace.conversations?.find((conversation) => conversation.id === activeId)
  return <nav aria-label="Saved chats" className="chat-switcher">
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="chat-switcher-trigger">
          <span className="truncate">{active ? active.title : 'Saved chats'}</span>
          <ChevronDown aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="chat-switcher-menu">
        {workspace.loading && !workspace.conversations && <p role="status" className="chat-rail-note">Loading chats…</p>}
        {workspace.conversations?.length === 0 && <p className="chat-rail-note">No saved chats yet. Start one when you’re ready.</p>}
        {workspace.conversations?.map((conversation) => <DropdownMenuItem key={conversation.id} asChild>
          <Link to={{ pathname: `/chat/${conversation.id}`, search }} aria-current={conversation.id === activeId ? 'page' : undefined}
            className={cn('chat-switcher-item', conversation.id === activeId && 'is-current')}>
            <span className="truncate font-semibold">{conversation.title}</span>
            <time dateTime={conversation.createdAt}>{fullLabel(conversation.createdAt)}</time>
          </Link>
        </DropdownMenuItem>)}
        {workspace.nextCursor && <Button variant="outline" size="sm" className="chat-rail-more" disabled={workspace.loadingMore} onClick={() => void workspace.loadMore()}>
          {workspace.loadingMore ? 'Loading…' : 'Load older chats'}
        </Button>}
      </DropdownMenuContent>
    </DropdownMenu>
  </nav>
}
