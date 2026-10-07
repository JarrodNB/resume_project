/**
 * Description: GraphQL operations for gap analysis (typed by GraphQL Code Generator).
 * Index:
 *   - ANALYZE_JOB_GAPS_MUTATION: starts an analyze_gaps AI task for one job
 *   - SAVE_GAP_RESPONSE_MUTATION: saves an answer to one requirement of a job
 * The job's latest analysis and saved answers come with JOB_QUERY (features/jobs); live status
 * from features/ai-tasks.
 */
import { graphql } from '@/graphql/generated'

export const ANALYZE_JOB_GAPS_MUTATION = graphql(`
  mutation AnalyzeJobGaps($jobId: ID!) {
    analyzeJobGaps(input: { jobId: $jobId }) {
      aiTask {
        id
        status
        result
        errorMessage
        createdAt
      }
      errors
    }
  }
`)

export const SAVE_GAP_RESPONSE_MUTATION = graphql(`
  mutation SaveGapResponse($jobId: ID!, $requirement: String!, $body: String!, $addToLibrary: Boolean!) {
    saveGapResponse(input: { jobId: $jobId, requirement: $requirement, body: $body, addToLibrary: $addToLibrary }) {
      jobGapResponse {
        id
        requirement
        body
        libraryFact {
          id
        }
      }
      errors
    }
  }
`)
