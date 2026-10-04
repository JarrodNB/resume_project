/**
 * Description: GraphQL operations for importing a resume (typed by GraphQL Code Generator).
 * Index:
 *   - PARSE_RESUME_MUTATION: uploads a file and starts a parse_resume AI task
 *   - IMPORT_PARSED_RESUME_MUTATION: imports the reviewed parse into the career library
 * Live task status comes from features/ai-tasks.
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

export const IMPORT_PARSED_RESUME_MUTATION = graphql(`
  mutation ImportParsedResume($aiTaskId: ID!, $parsedResume: JSON!) {
    importParsedResume(input: { aiTaskId: $aiTaskId, parsedResume: $parsedResume }) {
      aiTask {
        id
        acceptedAt
        result
      }
      errors
    }
  }
`)
