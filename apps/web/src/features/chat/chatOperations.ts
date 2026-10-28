/** Saved chat metadata and accepted public history, loaded independently from live model output. */
import { graphql } from '@/graphql/generated'

export const CHAT_WORKSPACE_QUERY = graphql(`
  query ChatWorkspace($cursor: String) {
    chatSettings { maxInputCharacters summarizeEveryUserMessages }
    chatConversations(cursor: $cursor) {
      conversations { id title createdAt updatedAt }
      nextCursor errors
    }
  }
`)

export const CHAT_CONVERSATION_QUERY = graphql(`
  query ChatConversation($id: ID!, $cursor: String) {
    chatConversation(id: $id) {
      id title createdAt updatedAt
      messages(cursor: $cursor) {
        messages { id role content position createdAt }
        nextCursor errors
      }
    }
  }
`)

export const CREATE_CHAT_CONVERSATION = graphql(`
  mutation CreateChatConversation {
    createChatConversation(input: {}) {
      conversation { id title createdAt updatedAt }
      errors
    }
  }
`)
