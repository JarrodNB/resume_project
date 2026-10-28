/** A saved career-chat workspace. The URL selects a conversation so refresh and bookmarks reopen it. */
import { Link, useNavigate, useParams } from 'react-router'
import { Plus } from 'lucide-react'
import { PageHeading } from '@/components/PageHeading'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { useChatConversation, useChatWorkspace } from './useChatWorkspace'

const dateLabel = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

export function ChatPage() {
  const { id } = useParams<{ id: string }>()
  const workspace = useChatWorkspace()
  const navigate = useNavigate()

  async function createChat() {
    const createdId = await workspace.createChat()
    if (createdId) void navigate(`/chat/${createdId}`)
  }

  return <div className="grid min-w-0 gap-6">
    <PageHeading title="Chat" description="Talk through your next career move. Your conversations stay saved here."
      actions={<Button disabled={workspace.creating} onClick={() => void createChat()}><Plus aria-hidden />{workspace.creating ? 'Starting…' : 'New chat'}</Button>} />
    <ErrorAlert title="Couldn't update your chats" messages={workspace.errors} />
    {workspace.error && <div className="grid justify-items-start gap-2">
      <ErrorAlert title="Couldn't load your chats" messages={[requestErrorMessage(workspace.error, 'Try loading your chats again.')]} />
      <Button variant="outline" onClick={() => void workspace.refetch().catch(() => undefined)}>Retry loading chats</Button>
    </div>}
    <div className="grid min-w-0 gap-6 md:grid-cols-[minmax(12rem,16rem)_minmax(0,1fr)]">
      <nav aria-label="Saved chats" className="min-w-0 border-b pb-5 md:border-r md:border-b-0 md:pr-5">
        <p className="mb-3 text-sm font-bold">Saved chats</p>
        {workspace.loading && !workspace.conversations && <p role="status" className="text-sm text-muted-foreground">Loading chats…</p>}
        {workspace.conversations?.length === 0 && <p className="text-sm text-muted-foreground">No saved chats yet. Start one when you’re ready.</p>}
        <ul className="grid gap-1">
          {workspace.conversations?.map((conversation) => <li key={conversation.id}>
            <Link to={`/chat/${conversation.id}`} aria-current={conversation.id === id ? 'page' : undefined}
              className={cn('grid gap-1 rounded border border-transparent px-3 py-3 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', conversation.id === id && 'border-border bg-muted')}>
              <span className="break-words font-semibold">{conversation.title}</span>
              <time dateTime={conversation.createdAt} className="text-xs text-muted-foreground">{dateLabel(conversation.createdAt)}</time>
            </Link>
          </li>)}
        </ul>
        {workspace.nextCursor && <Button variant="outline" className="mt-3" disabled={workspace.loadingMore} onClick={() => void workspace.loadMore()}>
          {workspace.loadingMore ? 'Loading…' : 'Load older chats'}
        </Button>}
      </nav>
      <div className="min-w-0">
        {id ? <SavedConversation key={id} id={id} /> : <div className="grid max-w-prose gap-3 py-8">
          <h2 className="text-2xl font-bold tracking-tight">Make room for your next step</h2>
          <p className="text-muted-foreground">Talk through applications, interview preparation, or a career decision. Start a new chat or reopen one from your saved chats.</p>
        </div>}
        <p className="mt-6 max-w-prose border-t pt-4 text-sm leading-relaxed text-muted-foreground">Careergrind can discuss your career and job search using what you share in chat. It cannot read your saved career details or take actions in the app yet.</p>
        {workspace.settings && <p className="mt-2 text-xs text-muted-foreground">Messages can contain up to {workspace.settings.maxInputCharacters.toLocaleString()} characters.</p>}
      </div>
    </div>
  </div>
}

/** Reads accepted dialogue only; partial model output will use a separate live execution view. */
function SavedConversation({ id }: { id: string }) {
  const history = useChatConversation(id)
  return <section aria-label="Conversation" className="grid min-w-0 gap-4">
    {history.loading && !history.conversation && <p role="status">Loading conversation…</p>}
    {history.error && <div className="grid justify-items-start gap-2">
      <ErrorAlert title="Couldn't open this chat" messages={[requestErrorMessage(history.error, 'Try loading the chat again.')]} />
      <Button variant="outline" onClick={() => void history.refetch().catch(() => undefined)}>Retry loading conversation</Button>
    </div>}
    <ErrorAlert title="Couldn't load chat history" messages={history.errors} />
    {history.conversation && <>
      <h2 className="break-words text-xl font-bold">{history.conversation.title}</h2>
      {history.conversation.messages.nextCursor && <Button variant="outline" className="justify-self-start" disabled={history.loadingMore} onClick={() => void history.loadOlder()}>
        {history.loadingMore ? 'Loading…' : 'Load earlier messages'}
      </Button>}
      {history.conversation.messages.messages.length === 0 ? <p className="py-8 text-muted-foreground">This chat is ready for your first message.</p> : <ol className="grid gap-6">
        {history.conversation.messages.messages.map((message) => <li key={message.id} className="grid gap-2 border-b pb-6 last:border-0">
          <p className="text-sm font-bold">{message.role === 'user' ? 'You' : 'Careergrind'}</p>
          <p className="max-w-prose whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
        </li>)}
      </ol>}
    </>}
  </section>
}
