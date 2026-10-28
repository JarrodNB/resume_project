/**
 * A saved career-chat workspace. The URL selects a conversation so refresh and bookmarks reopen it.
 *
 * Three design options share this page's data and behavior; `?layout=` picks which one is drawn
 * (see chatLayouts.ts). Each option's look lives in the `.chat-*` rules in index.css.
 */
import { useNavigate, useParams } from 'react-router'
import { Plus } from 'lucide-react'
import { PageHeading } from '@/components/PageHeading'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { useChatConversation, useChatWorkspace } from './useChatWorkspace'
import { ChatTurn } from './ChatTurn'
import { ChatConversationList } from './ChatConversationList'
import { ChatLayoutSwitch } from './ChatLayoutSwitch'
import { useChatLayout } from './chatLayouts'

export function ChatPage() {
  const { id } = useParams<{ id: string }>()
  const workspace = useChatWorkspace()
  const navigate = useNavigate()
  const { layout, search, choose } = useChatLayout()
  const maxCharacters = workspace.settings?.maxInputCharacters ?? 10000

  async function createChat() {
    const createdId = await workspace.createChat()
    if (createdId) void navigate({ pathname: `/chat/${createdId}`, search })
  }

  const newChat = <Button disabled={workspace.creating} onClick={() => void createChat()}><Plus aria-hidden />{workspace.creating ? 'Starting…' : 'New chat'}</Button>
  const list = <ChatConversationList workspace={workspace} activeId={id} layout={layout} search={search} />
  const scope = <>
    <p>Careergrind can discuss your career and job search using what you share in chat.</p>
    <p>It cannot read your saved career details or take actions in the app yet.</p>
  </>

  return <div className="chat-page" data-layout={layout}>
    <PageHeading title="Chat" description="Talk through your next career move. Your conversations stay saved here."
      actions={<>
        {layout === 'line' && list}
        {newChat}
      </>} />
    <ChatLayoutSwitch layout={layout} onChoose={choose} />
    <ErrorAlert title="Couldn't update your chats" messages={workspace.errors} />
    {workspace.error && <div className="grid justify-items-start gap-2">
      <ErrorAlert title="Couldn't load your chats" messages={[requestErrorMessage(workspace.error, 'Try loading your chats again.')]} />
      <Button variant="outline" onClick={() => void workspace.refetch().catch(() => undefined)}>Retry loading chats</Button>
    </div>}
    <div className="chat-body">
      {layout !== 'line' && list}
      <div className="chat-main">
        {id ? <SavedConversation key={id} id={id} maxCharacters={maxCharacters} /> : <div className="chat-start">
          <h2>Make room for your next step</h2>
          <p>Talk through applications, interview preparation, or a career decision. Start a new chat or reopen one from your saved chats.</p>
        </div>}
        <div className="chat-notice">{scope}<p>Messages can contain up to {maxCharacters.toLocaleString()} characters.</p></div>
      </div>
      {layout === 'desk' && <aside aria-label="About this chat" className="chat-about">
        <h2>About this chat</h2>
        {scope}
        <p>Messages can contain up to {maxCharacters.toLocaleString()} characters.</p>
      </aside>}
    </div>
  </div>
}

/** Reads accepted dialogue only; partial model output will use a separate live execution view. */
function SavedConversation({ id, maxCharacters }: { id: string; maxCharacters: number }) {
  const history = useChatConversation(id)
  return <section aria-label="Conversation" className="chat-conversation">
    {history.loading && !history.conversation && <p role="status" className="chat-empty">Loading conversation…</p>}
    {history.error && <div className="chat-alert">
      <ErrorAlert title="Couldn't open this chat" messages={[requestErrorMessage(history.error, 'Try loading the chat again.')]} />
      <Button variant="outline" onClick={() => void history.refetch().catch(() => undefined)}>Retry loading conversation</Button>
    </div>}
    <ErrorAlert title="Couldn't load chat history" messages={history.errors} />
    {history.conversation && <>
      <h2 className="chat-title">{history.conversation.title}</h2>
      <ChatTurn conversationId={id} maxCharacters={maxCharacters} messages={history.conversation.messages.messages}
        onAccepted={() => history.refetch().then(() => undefined)}
        earlier={history.conversation.messages.nextCursor ? <Button variant="outline" className="chat-earlier" disabled={history.loadingMore} onClick={() => void history.loadOlder()}>
          {history.loadingMore ? 'Loading…' : 'Load earlier messages'}
        </Button> : undefined} />
    </>}
  </section>
}
