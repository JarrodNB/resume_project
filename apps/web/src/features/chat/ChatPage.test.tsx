/** Exercises saved-chat navigation and history through user interactions and mocked GraphQL. */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { ChatPage } from './ChatPage'
import { CHAT_OPERATION_QUERY, CHAT_CONVERSATION_UPDATED } from './chatTurnOperations'
import { CHAT_CONVERSATION_QUERY, CHAT_WORKSPACE_QUERY, CREATE_CHAT_CONVERSATION } from './chatOperations'

function conversation(id: string, title = 'New chat') {
  return { __typename: 'ChatConversation', id, title, createdAt: '2026-10-28T00:00:00Z', updatedAt: '2026-10-28T00:00:00Z' }
}
function operationMocks(id: string) {
  const snapshot = { __typename: 'ChatConversation', id, latestOperation: null }
  return [
    { request: { query: CHAT_OPERATION_QUERY, variables: { id } }, result: { data: { chatConversation: snapshot } } },
    { request: { query: CHAT_CONVERSATION_UPDATED, variables: { id } }, result: { data: { chatConversationUpdated: snapshot } } },
  ]
}
function workspaceMock(conversations = [conversation('chat-1', 'Preparing for interviews')], nextCursor: string | null = null, cursor: string | null = null) {
  return { request: { query: CHAT_WORKSPACE_QUERY, variables: { cursor } }, result: { data: {
    chatSettings: { __typename: 'ChatSettings', maxInputCharacters: 10000, summarizeEveryUserMessages: 20 },
    chatConversations: { __typename: 'ChatConversationPage', conversations, nextCursor, errors: [] },
  } } }
}
function historyMock(id: string, messages: { id: string; role: string; content: string; position: number; thumbsDown?: boolean }[] = [], nextCursor: string | null = null, cursor: string | null = null) {
  return { request: { query: CHAT_CONVERSATION_QUERY, variables: { id, cursor } }, result: { data: {
    chatConversation: { ...conversation(id, id === 'chat-1' ? 'Preparing for interviews' : 'New chat'), messages: { __typename: 'ChatMessagePage', messages: messages.map((message) => ({ __typename: 'ChatMessage', thumbsDown: false, thumbsUp: false, ...message, createdAt: '2026-10-28T00:00:00Z' })), nextCursor, errors: [] } },
  } } }
}

it('lists saved chats and opens a newly saved empty conversation', async () => {
  const created = conversation('chat-2')
  const { router } = renderPage({ path: '/chat/:id?', url: '/chat', element: <ChatPage />, mocks: [workspaceMock(), {
    request: { query: CREATE_CHAT_CONVERSATION }, result: { data: { createChatConversation: { __typename: 'CreateConversationPayload', conversation: created, errors: [] } } },
  }, workspaceMock([created, conversation('chat-1', 'Preparing for interviews')]), historyMock('chat-2'), ...operationMocks('chat-2')] })
  expect(await screen.findByRole('link', { name: /Preparing for interviews/ })).toHaveAttribute('href', '/chat/chat-1')
  fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
  await waitFor(() => expect(router.state.location.pathname).toBe('/chat/chat-2'))
  expect(await screen.findByText('This chat is ready for your first message.')).toBeInTheDocument()
  expect(screen.getAllByText(/cannot read your saved career details or take actions/).length).toBeGreaterThan(0)
  expect(screen.getByRole('textbox', { name: 'Your message' })).toBeInTheDocument()
})

it('reopens saved dialogue directly after refresh and prepends earlier history', async () => {
  renderPage({ path: '/chat/:id?', url: '/chat/chat-1', element: <ChatPage />, mocks: [workspaceMock(), ...operationMocks('chat-1'),
    historyMock('chat-1', [{ id: 'm3', role: 'user', content: 'How should I prepare?', position: 3 }, { id: 'm4', role: 'assistant', content: 'Start with the role requirements.', position: 4 }], 'older'),
    historyMock('chat-1', [{ id: 'm1', role: 'user', content: 'I have an interview.', position: 1 }, { id: 'm2', role: 'assistant', content: 'What role is it for?', position: 2 }], null, 'older'),
  ] })
  expect(await screen.findByText('Start with the role requirements.')).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: 'Thumbs down' })).toHaveLength(1)
  expect(await screen.findByRole('link', { name: /Preparing for interviews/ })).toHaveAttribute('aria-current', 'page')
  fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' }))
  expect(await screen.findByText('I have an interview.')).toBeInTheDocument()
  const text = screen.getByRole('region', { name: 'Conversation' }).textContent ?? ''
  expect(text.indexOf('I have an interview.')).toBeLessThan(text.indexOf('How should I prepare?'))
  expect(screen.queryByRole('button', { name: 'Load earlier messages' })).not.toBeInTheDocument()
})

it('loads another saved-chat page without losing the first page', async () => {
  renderPage({ path: '/chat/:id?', url: '/chat', element: <ChatPage />, mocks: [workspaceMock(undefined, 'older-chats'), workspaceMock([conversation('old', 'Changing careers')], null, 'older-chats')] })
  fireEvent.click(await screen.findByRole('button', { name: 'Load older chats' }))
  expect(await screen.findByRole('link', { name: /Changing careers/ })).toHaveAttribute('href', '/chat/old')
  expect(screen.getByRole('link', { name: /Preparing for interviews/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Load older chats' })).not.toBeInTheDocument()
})

it('retains saved chats and stays put when creating a chat fails', async () => {
  const { router } = renderPage({ path: '/chat/:id?', url: '/chat', element: <ChatPage />, mocks: [workspaceMock(), {
    request: { query: CREATE_CHAT_CONVERSATION }, result: { data: { createChatConversation: { __typename: 'CreateConversationPayload', conversation: null, errors: ['Could not save this chat. Try again.'] } } },
  }] })
  await screen.findByRole('link', { name: /Preparing for interviews/ })
  fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
  expect(await screen.findByText('Could not save this chat. Try again.')).toBeInTheDocument()
  expect(router.state.location.pathname).toBe('/chat')
  expect(screen.getByRole('link', { name: /Preparing for interviews/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'New chat' })).toBeEnabled()
})

it('offers recovery when a bookmarked chat cannot be loaded', async () => {
  renderPage({ path: '/chat/:id?', url: '/chat/missing', element: <ChatPage />, mocks: [workspaceMock(), {
    request: { query: CHAT_CONVERSATION_QUERY, variables: { id: 'missing', cursor: null } }, error: new Error('Record not found'),
  }, historyMock('missing'), ...operationMocks('missing')] })
  expect(await screen.findByText("Couldn't open this chat")).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading conversation' }))
  expect(await screen.findByText('This chat is ready for your first message.')).toBeInTheDocument()
})

it('shows the notes panel beside the conversation', async () => {
  renderPage({ path: '/chat/:id?', url: '/chat', element: <ChatPage />, mocks: [workspaceMock()] })
  expect(await screen.findByRole('link', { name: /Preparing for interviews/ })).toHaveAttribute('href', '/chat/chat-1')
  expect(screen.getByRole('complementary', { name: 'About this chat' })).toHaveTextContent('Messages can contain up to 10,000 characters.')
})
