/** Sends and recovers chat turns through user interactions and canonical GraphQL snapshots. */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { ChatTurn } from './ChatTurn'
import { CHAT_CONVERSATION_UPDATED, CHAT_OPERATION_QUERY, SEND_CHAT_MESSAGE, RETRY_CHAT_MESSAGE, AUTHORIZE_CHAT_OUTPUT } from './chatTurnOperations'

const operation = (status: string, extra = {}) => ({ __typename: 'ChatOperation', id: 'op-1', status, message: 'Help me prepare.',
  failureCode: null, retryAt: null, attemptId: null, claimGeneration: 0, executionCount: 0, idempotencyKey: 'submission', updatedAt: '2026-10-28T00:00:00Z', ...extra })
const snapshot = (latestOperation: ReturnType<typeof operation> | null) => ({ __typename: 'ChatConversation', id: 'chat-1', latestOperation })
const query = (latestOperation: ReturnType<typeof operation> | null = null) => ({ request: { query: CHAT_OPERATION_QUERY, variables: { id: 'chat-1' } }, result: { data: { chatConversation: snapshot(latestOperation) } } })
const subscription = (latestOperation: ReturnType<typeof operation> | null = null) => ({ request: { query: CHAT_CONVERSATION_UPDATED, variables: { id: 'chat-1' } }, result: { data: { chatConversationUpdated: snapshot(latestOperation) } } })

it('sends once and shows the durable pending message while disabling another send', async () => {
  const send = vi.fn(() => ({ data: { sendChatMessage: { __typename: 'SendChatMessagePayload', operation: operation('pending'), errors: [] } } }))
  renderPage({ path: '/chat/:id', url: '/chat/chat-1', element: <ChatTurn conversationId="chat-1" maxCharacters={10000} onAccepted={vi.fn()} />, mocks: [query(), subscription(), {
    request: { query: SEND_CHAT_MESSAGE, variables: (variables) => variables.input.conversationId === 'chat-1' && variables.input.message === 'Help me prepare.' && typeof variables.input.idempotencyKey === 'string' }, result: send,
  }] })
  const textbox = await screen.findByRole('textbox', { name: 'Your message' })
  fireEvent.change(textbox, { target: { value: 'Help me prepare.' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
  expect(await screen.findByText('Preparing your reply…')).toBeInTheDocument()
  expect(screen.getByText('Help me prepare.')).toBeInTheDocument()
  expect(textbox).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
  expect(send).toHaveBeenCalledTimes(1)
})

it('counts Unicode characters and rejects oversized input before sending', async () => {
  renderPage({ path: '/chat/:id', url: '/chat/chat-1', element: <ChatTurn conversationId="chat-1" maxCharacters={2} onAccepted={vi.fn()} />, mocks: [query(), subscription()] })
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '😀😀' } })
  expect(screen.getByText('2 / 2 characters')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled())
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '😀😀a' } })
  expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
  expect(screen.getByText(/shorten your message/)).toBeInTheDocument()
})

it('reopens a failed message and reconciles before retrying the same operation', async () => {
  const failed = operation('failed', { failureCode: 'dependency_unavailable' })
  const retry = vi.fn(() => ({ data: { retryChatMessage: { __typename: 'RetryChatMessagePayload', operation: operation('pending', { updatedAt: '2026-10-28T00:01:00Z' }), errors: [] } } }))
  renderPage({ path: '/chat/:id', url: '/chat/chat-1', element: <ChatTurn conversationId="chat-1" maxCharacters={10000} onAccepted={vi.fn()} />, mocks: [query(failed), subscription(failed), query(failed), {
    request: { query: RETRY_CHAT_MESSAGE, variables: { input: { operationId: 'op-1' } } }, result: retry,
  }] })
  expect(await screen.findByText('The AI service is unavailable. Try again shortly.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Retry reply' }))
  expect(await screen.findByText('Preparing your reply…')).toBeInTheDocument()
  expect(retry).toHaveBeenCalledTimes(1)
})

it('refreshes saved history when an accepted subscription replaces pending state', async () => {
  const accepted = vi.fn()
  renderPage({ path: '/chat/:id', url: '/chat/chat-1', element: <ChatTurn conversationId="chat-1" maxCharacters={10000} onAccepted={accepted} />, mocks: [{ ...query(operation('pending')), delay: 0 }, {
    ...subscription(operation('accepted', { updatedAt: '2026-10-28T00:01:00Z' })), delay: 200,
  }] })
  expect(await screen.findByText('Preparing your reply…')).toBeInTheDocument()
  await waitFor(() => expect(accepted).toHaveBeenCalledTimes(1))
  expect(screen.queryByText('Preparing your reply…')).not.toBeInTheDocument()
  expect(screen.getByRole('textbox')).toBeEnabled()
})

it('keeps the exact submission key after an ambiguous write and checks saved status before retrying', async () => {
  const submissionKey = '00000000-0000-4000-8000-000000000001'
  const key = vi.spyOn(crypto, 'randomUUID').mockReturnValue(submissionKey)
  try {
    const send = vi.fn()
    renderPage({ path: '/chat/:id', url: '/chat/chat-1', element: <ChatTurn conversationId="chat-1" maxCharacters={10000} onAccepted={vi.fn()} />, mocks: [query(), subscription(), {
      request: { query: SEND_CHAT_MESSAGE, variables: { input: { conversationId: 'chat-1', message: 'Help me prepare.', idempotencyKey: submissionKey } } },
      error: new Error('Connection lost'),
    }, query(operation('pending', { idempotencyKey: submissionKey }))] })
    const textbox = screen.getByRole('textbox')
    fireEvent.change(textbox, { target: { value: 'Help me prepare.' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByText('Connection lost')).toBeInTheDocument()
    expect(textbox).toHaveValue('Help me prepare.')
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByText('Preparing your reply…')).toBeInTheDocument()
    expect(textbox).toHaveValue('')
    expect(send).not.toHaveBeenCalled()
  } finally { key.mockRestore() }
})

it('ignores a delayed older subscription snapshot within the same millisecond', async () => {
  const accepted = vi.fn()
  renderPage({ path: '/chat/:id', url: '/chat/chat-1', element: <ChatTurn conversationId="chat-1" maxCharacters={10000} onAccepted={accepted} />, mocks: [
    { ...query(operation('accepted', { updatedAt: '2026-10-28T00:00:00.000200Z' })), delay: 0 },
    { ...subscription(operation('pending', { updatedAt: '2026-10-28T00:00:00.000100Z' })), delay: 100 },
  ] })
  await waitFor(() => expect(accepted).toHaveBeenCalledTimes(1))
  await new Promise((resolve) => setTimeout(resolve, 150))
  expect(screen.queryByText('Preparing your reply…')).not.toBeInTheDocument()
})

it('shows streamed text provisionally then restores the canonical reply after a buffer reset', async () => {
  class OutputSocket {
    static current: OutputSocket | null = null
    onopen: (() => void) | null = null
    onmessage: ((event: { data: string }) => void) | null = null
    onclose: (() => void) | null = null
    onerror: (() => void) | null = null
    sent: string[] = []
    constructor() { OutputSocket.current = this }
    send(value: string) { this.sent.push(value) }
    close() {}
  }
  vi.stubGlobal('WebSocket', OutputSocket)
  try {
    const accepted = vi.fn()
    const running = operation('running', { attemptId: 'attempt-1', claimGeneration: 1 })
    renderPage({ path: '/chat/:id', url: '/chat/chat-1', element: <ChatTurn conversationId="chat-1" maxCharacters={10000} onAccepted={accepted} />, mocks: [query(running), subscription(running), {
      request: { query: AUTHORIZE_CHAT_OUTPUT, variables: { input: { feature: 'chat', operationId: 'op-1' } } },
      result: { data: { authorizeAiExecutionStream: { __typename: 'AuthorizeAiExecutionStreamPayload', token: 'observer-capability', expiresAt: '2026-10-28T00:01:00Z', errors: [] } } },
    }, query(operation('accepted', { ...running, status: 'accepted', updatedAt: '2026-10-28T00:01:00Z' }))] })
    await waitFor(() => expect(OutputSocket.current).not.toBeNull())
    const socket = OutputSocket.current!
    socket.onopen?.()
    expect(JSON.parse(socket.sent[0])).toMatchObject({ type: 'authorize', token: 'observer-capability' })
    expect(screen.getByRole('status')).toHaveTextContent('Preparing your reply')
    socket.onmessage?.({ data: JSON.stringify({ version: 1, type: 'delta', feature: 'chat', operation_id: 'op-1', attempt_id: 'attempt-1', claim_generation: 1, cursor: '1-0', text: 'A provisional' }) })
    expect(await screen.findByText('A provisional')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Writing reply')
    socket.onmessage?.({ data: JSON.stringify({ version: 1, type: 'delta', feature: 'chat', operation_id: 'op-1', attempt_id: 'attempt-1', claim_generation: 1, cursor: '2-0', text: ' suggestion.' }) })
    expect(await screen.findByText('A provisional suggestion.')).toBeInTheDocument()
    socket.onmessage?.({ data: JSON.stringify({ type: 'reset', code: 'saved_state_required' }) })
    await waitFor(() => expect(accepted).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('A provisional suggestion.')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeEnabled()
  } finally { vi.unstubAllGlobals() }
})

it('keeps streamed text in the conversation while saved history is loading', async () => {
  class OutputSocket {
    static current: OutputSocket | null = null
    onopen: (() => void) | null = null
    onmessage: ((event: { data: string }) => void) | null = null
    onclose: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor() { OutputSocket.current = this }
    send() {}
    close() {}
  }
  vi.stubGlobal('WebSocket', OutputSocket)
  let finishRefresh!: () => void
  const refresh = vi.fn(() => new Promise<void>((resolve) => { finishRefresh = resolve }))
  try {
    const running = operation('running', { attemptId: 'attempt-1', claimGeneration: 1 })
    const accepted = operation('accepted', { attemptId: 'attempt-1', claimGeneration: 1, updatedAt: '2026-10-28T00:01:00Z' })
    renderPage({ path: '/chat/:id', url: '/chat/chat-1', element: <ChatTurn conversationId="chat-1" maxCharacters={10000} onAccepted={refresh} />, mocks: [
      query(running), { ...subscription(accepted), delay: 300 },
      { request: { query: AUTHORIZE_CHAT_OUTPUT, variables: { input: { feature: 'chat', operationId: 'op-1' } } }, result: { data: { authorizeAiExecutionStream: { __typename: 'AuthorizeAiExecutionStreamPayload', token: 'token', expiresAt: '2026-10-28T00:01:00Z', errors: [] } } } },
    ] })
    await waitFor(() => expect(OutputSocket.current).not.toBeNull())
    OutputSocket.current!.onmessage?.({ data: JSON.stringify({ type: 'delta', feature: 'chat', operation_id: 'op-1', attempt_id: 'attempt-1', claim_generation: 1, cursor: '1-0', text: 'A streamed reply.' }) })
    const reply = await screen.findByText('A streamed reply.')
    expect(reply.closest('ol')).not.toBeNull()
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(screen.getByText('A streamed reply.')).toBeInTheDocument()
    expect(screen.getByText('Help me prepare.')).toBeInTheDocument()
    finishRefresh()
    await waitFor(() => expect(screen.queryByText('A streamed reply.')).not.toBeInTheDocument())
  } finally { vi.unstubAllGlobals() }
})
