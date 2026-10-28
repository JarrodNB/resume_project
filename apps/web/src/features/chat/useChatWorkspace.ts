/** Loads owner-scoped saved chats and history; cursors keep older pages stable as new chats arrive. */
import { useState } from 'react'
import { useMutation, useQuery } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { CHAT_CONVERSATION_QUERY, CHAT_WORKSPACE_QUERY, CREATE_CHAT_CONVERSATION } from './chatOperations'

export function useChatWorkspace() {
  const query = useQuery(CHAT_WORKSPACE_QUERY, { variables: { cursor: null }, fetchPolicy: 'cache-and-network' })
  const [mutate, creation] = useMutation(CREATE_CHAT_CONVERSATION)
  const [errors, setErrors] = useState<string[]>([])
  const [loadingMore, setLoadingMore] = useState(false)

  async function createChat() {
    setErrors([])
    try {
      const { data } = await mutate()
      const payload = data?.createChatConversation
      if (!payload?.conversation || payload.errors.length) {
        setErrors(payload?.errors ?? ['Could not start a chat. Try again.'])
        return null
      }
      // The saved identity is usable even if refreshing the sidebar fails.
      void query.refetch().catch(() => setErrors(['Chat saved, but the list could not refresh. Reload the page to see it.']))
      return payload.conversation.id
    } catch (error) {
      setErrors([requestErrorMessage(error, 'Could not start a chat. Try again.')])
      return null
    }
  }

  async function loadMore() {
    const cursor = query.data?.chatConversations.nextCursor
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    setErrors([])
    try {
      await query.fetchMore({ variables: { cursor }, updateQuery: (previous, { fetchMoreResult }) => {
        if (fetchMoreResult.chatConversations.errors.length) {
          setErrors(fetchMoreResult.chatConversations.errors)
          return previous
        }
        const seen = new Set(previous.chatConversations.conversations.map((item) => item.id))
        return { ...previous, chatConversations: { ...fetchMoreResult.chatConversations, conversations: [
          ...previous.chatConversations.conversations,
          ...fetchMoreResult.chatConversations.conversations.filter((item) => !seen.has(item.id)),
        ] } }
      } })
    } catch (error) {
      setErrors([requestErrorMessage(error, 'Could not load older chats. Try again.')])
    } finally {
      setLoadingMore(false)
    }
  }

  return { ...query, conversations: query.data?.chatConversations.conversations,
    settings: query.data?.chatSettings, nextCursor: query.data?.chatConversations.nextCursor,
    errors: [...errors, ...(query.data?.chatConversations.errors ?? [])],
    createChat, creating: creation.loading, loadMore, loadingMore }
}

export function useChatConversation(id: string) {
  const query = useQuery(CHAT_CONVERSATION_QUERY, { variables: { id, cursor: null }, fetchPolicy: 'cache-and-network' })
  const [errors, setErrors] = useState<string[]>([])
  const [loadingMore, setLoadingMore] = useState(false)

  async function loadOlder() {
    const cursor = query.data?.chatConversation.messages.nextCursor
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    setErrors([])
    try {
      await query.fetchMore({ variables: { cursor }, updateQuery: (previous, { fetchMoreResult }) => {
        const page = fetchMoreResult.chatConversation.messages
        if (page.errors.length) {
          setErrors(page.errors)
          return previous
        }
        const existing = previous.chatConversation.messages.messages
        const seen = new Set(existing.map((message) => message.id))
        return { ...previous, chatConversation: { ...previous.chatConversation, messages: {
          ...page, messages: [...page.messages.filter((message) => !seen.has(message.id)), ...existing],
        } } }
      } })
    } catch (error) {
      setErrors([requestErrorMessage(error, 'Could not load earlier messages. Try again.')])
    } finally {
      setLoadingMore(false)
    }
  }
  return { ...query, conversation: query.data?.chatConversation,
    errors: [...errors, ...(query.data?.chatConversation.messages.errors ?? [])], loadOlder, loadingMore }
}
