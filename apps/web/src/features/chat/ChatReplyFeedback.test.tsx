/** Verifies persisted desired-state feedback, its pending state, undo and retry affordance. */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing/react'
import { render } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ChatReplyFeedback } from './ChatReplyFeedback'
import { SET_CHAT_MESSAGE_FEEDBACK } from './chatOperations'

const request = (thumbsDown: boolean) => ({ query: SET_CHAT_MESSAGE_FEEDBACK, variables: { conversationId: 'chat-1', messageId: 'reply-1', thumbsDown } })
const result = (thumbsDown: boolean) => ({ data: { setChatMessageFeedback: { __typename: 'SetMessageFeedbackPayload', message: { __typename: 'ChatMessage', id: 'reply-1', thumbsDown, thumbsUp: false }, errors: [] } } })

it('saves thumbs down, prevents duplicate clicks while pending, and saves undo', async () => {
  const setFeedback = vi.fn(() => result(true))
  const clearFeedback = vi.fn(() => result(false))
  render(<MockedProvider mocks={[{ request: request(true), result: setFeedback, delay: 50 }, { request: request(false), result: clearFeedback }]}>
    <ChatReplyFeedback conversationId="chat-1" messageId="reply-1" thumbsDown={false} thumbsUp={false} />
  </MockedProvider>)
  const button = screen.getByRole('button', { name: 'Thumbs down' })
  expect(button).toHaveAttribute('aria-pressed', 'false')
  fireEvent.click(button)
  expect(button).toBeDisabled()
  fireEvent.click(button)
  await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'))
  expect(setFeedback).toHaveBeenCalledTimes(1)
  fireEvent.click(button)
  await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'false'))
  expect(clearFeedback).toHaveBeenCalledTimes(1)
})

it('shows persisted feedback immediately when a saved reply is reopened', () => {
  render(<MockedProvider><ChatReplyFeedback conversationId="chat-1" messageId="reply-1" thumbsDown thumbsUp={false} /></MockedProvider>)
  expect(screen.getByRole('button', { name: 'Thumbs down' })).toHaveAttribute('aria-pressed', 'true')
})

it('keeps the confirmed state when saving fails and retries the same desired state', async () => {
  const saved = vi.fn(() => result(true))
  render(<MockedProvider mocks={[{ request: request(true), error: new Error('Network unavailable') }, { request: request(true), result: saved }]}>
    <ChatReplyFeedback conversationId="chat-1" messageId="reply-1" thumbsDown={false} thumbsUp={false} />
  </MockedProvider>)
  const button = screen.getByRole('button', { name: 'Thumbs down' })
  fireEvent.click(button)
  expect(await screen.findByRole('alert')).toHaveTextContent('Feedback was not saved. Try again.')
  expect(button).toHaveAttribute('aria-pressed', 'false')
  expect(button).toBeEnabled()
  fireEvent.click(button)
  await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(saved).toHaveBeenCalledTimes(1)
})

it('preserves a thumbs-down mark when removing it fails', async () => {
  render(<MockedProvider mocks={[{ request: request(false), result: { data: { setChatMessageFeedback: { __typename: 'SetMessageFeedbackPayload', message: null, errors: ['Could not save feedback. Try again.'] } } } }]}>
    <ChatReplyFeedback conversationId="chat-1" messageId="reply-1" thumbsDown thumbsUp={false} />
  </MockedProvider>)
  const button = screen.getByRole('button', { name: 'Thumbs down' })
  fireEvent.click(button)
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save feedback. Try again.')
  expect(button).toHaveAttribute('aria-pressed', 'true')
  expect(button).toBeEnabled()
})


it('reflects refreshed saved feedback without an extra write', () => {
  const view = render(<MockedProvider><ChatReplyFeedback conversationId="chat-1" messageId="reply-1" thumbsDown={false} thumbsUp={false} /></MockedProvider>)
  view.rerender(<MockedProvider><ChatReplyFeedback conversationId="chat-1" messageId="reply-1" thumbsDown thumbsUp={false} /></MockedProvider>)
  expect(screen.getByRole('button', { name: 'Thumbs down' })).toHaveAttribute('aria-pressed', 'true')
})

 it('saves a thumbs up and clears an existing thumbs down', async () => {
  const requestUp = { query: SET_CHAT_MESSAGE_FEEDBACK, variables: { conversationId: 'chat-1', messageId: 'reply-1', thumbsUp: true } }
  const resultUp = { data: { setChatMessageFeedback: { __typename: 'SetMessageFeedbackPayload', message: { __typename: 'ChatMessage', id: 'reply-1', thumbsDown: false, thumbsUp: true }, errors: [] } } }
  render(<MockedProvider mocks={[{ request: requestUp, result: resultUp }]}><ChatReplyFeedback conversationId="chat-1" messageId="reply-1" thumbsDown thumbsUp={false} /></MockedProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Thumbs up' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Thumbs up' })).toHaveAttribute('aria-pressed', 'true'))
  expect(screen.getByRole('button', { name: 'Thumbs down' })).toHaveAttribute('aria-pressed', 'false')
})
