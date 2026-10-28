/** Owner-scoped operation state is durable; streamed text remains a separate provisional view. */
import { graphql } from '@/graphql/generated'

export const CHAT_OPERATION_QUERY = graphql(`
  query ChatOperation($id: ID!) {
    chatConversation(id: $id) {
      id
      latestOperation { id status message failureCode retryAt attemptId claimGeneration executionCount idempotencyKey updatedAt }
    }
  }
`)
export const CHAT_CONVERSATION_UPDATED = graphql(`
  subscription ChatConversationUpdated($id: ID!) {
    chatConversationUpdated(id: $id) {
      id
      latestOperation { id status message failureCode retryAt attemptId claimGeneration executionCount idempotencyKey updatedAt }
    }
  }
`)
export const SEND_CHAT_MESSAGE = graphql(`
  mutation SendChatMessage($input: SendMessageInput!) {
    sendChatMessage(input: $input) {
      operation { id status message failureCode retryAt attemptId claimGeneration executionCount idempotencyKey updatedAt }
      errors
    }
  }
`)
export const RETRY_CHAT_MESSAGE = graphql(`
  mutation RetryChatMessage($input: RetryMessageInput!) {
    retryChatMessage(input: $input) {
      operation { id status message failureCode retryAt attemptId claimGeneration executionCount idempotencyKey updatedAt }
      errors
    }
  }
`)
export const AUTHORIZE_CHAT_OUTPUT = graphql(`
  mutation AuthorizeChatOutput($input: AuthorizeAiExecutionStreamInput!) {
    authorizeAiExecutionStream(input: $input) { token expiresAt errors }
  }
`)
