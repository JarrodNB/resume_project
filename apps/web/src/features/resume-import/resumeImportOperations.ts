/**
 * Description: GraphQL operations for importing a resume (typed by GraphQL Code Generator).
 * Index:
 *   - PARSE_RESUME_MUTATION: uploads a file and starts a parse_resume AI task
 *   - AI_TASK_UPDATED_SUBSCRIPTION: live status of an AI task (sends the current state first)
 *   - IMPORT_PARSED_RESUME_MUTATION: imports the reviewed parse into the career library
 */
import { graphql } from '@/graphql/generated'

export const PARSE_RESUME_MUTATION = graphql(`
  mutation ParseResume($file: Upload!) {
    parseResume(input: { file: $file }) {
      aiTask {
        id
        status
      }
      errors
    }
  }
`)

export const AI_TASK_UPDATED_SUBSCRIPTION = graphql(`
  subscription AiTaskUpdated($id: ID!) {
    aiTaskUpdated(id: $id) {
      id
      taskType
      status
      result
      errorMessage
      acceptedAt
      createdAt
    }
  }
`)

export const IMPORT_PARSED_RESUME_MUTATION = graphql(`
  mutation ImportParsedResume($aiTaskId: ID!, $parsedResume: JSON!) {
    importParsedResume(input: { aiTaskId: $aiTaskId, parsedResume: $parsedResume }) {
      resume {
        id
        title
      }
      errors
    }
  }
`)
