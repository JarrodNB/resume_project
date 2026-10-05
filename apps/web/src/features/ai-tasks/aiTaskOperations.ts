/**
 * Description: GraphQL operations shared by every feature that follows an AI task.
 * Index:
 *   - AI_TASK_UPDATED_SUBSCRIPTION: live status of an AI task (sends the current state first)
 */
import { graphql } from '@/graphql/generated'

export const AI_TASK_UPDATED_SUBSCRIPTION = graphql(`
  subscription AiTaskUpdated($id: ID!) {
    aiTaskUpdated(id: $id) {
      id
      taskType
      status
      result
      input
      pendingQuestions
      errorMessage
      acceptedAt
      createdAt
      job {
        id
      }
    }
  }
`)
