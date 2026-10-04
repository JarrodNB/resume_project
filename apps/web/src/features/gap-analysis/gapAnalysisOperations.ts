/**
 * Description: GraphQL operations for gap analysis (typed by GraphQL Code Generator).
 * Index:
 *   - ANALYZE_JOB_GAPS_MUTATION: starts an analyze_gaps AI task for one job
 * The job's latest analysis comes with JOB_QUERY (features/jobs); live status from features/ai-tasks.
 */
import { graphql } from '@/graphql/generated'

export const ANALYZE_JOB_GAPS_MUTATION = graphql(`
  mutation AnalyzeJobGaps($jobId: ID!) {
    analyzeJobGaps(input: { jobId: $jobId }) {
      aiTask {
        id
        status
      }
      errors
    }
  }
`)
