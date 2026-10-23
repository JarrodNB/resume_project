/** GraphQL operations for starting a complete draft and saving or editing a resume.
 * Live generation status comes from the shared AI task subscription.
 */
import { graphql } from '@/graphql/generated'

export const TAILOR_JOB_QUERY = graphql(`
  query TailorJob($id: ID!) {
    job(id: $id) {
      id
      title
      company
      resume {
        id
        title
        markdown
        targetPages
      }
      latestTailoring {
        id
        status
        acceptedAt
        result
        errorMessage
      }
    }
  }
`)

export const START_RESUME_TAILORING_MUTATION = graphql(`
  mutation StartResumeTailoring($jobId: ID!) {
    startResumeTailoring(input: { jobId: $jobId }) {
      aiTask {
        id
        status
      }
      errors
    }
  }
`)

export const SAVE_TAILORED_RESUME_MUTATION = graphql(`
  mutation SaveTailoredResume($aiTaskId: ID!, $markdown: String) {
    saveTailoredResume(input: { aiTaskId: $aiTaskId, markdown: $markdown }) {
      resume {
        id
        title
      }
      errors
    }
  }
`)

export const UPDATE_RESUME_MUTATION = graphql(`
  mutation UpdateResume($id: ID!, $markdown: String!) {
    updateResume(input: { id: $id, markdown: $markdown }) {
      resume {
        id
        title
        markdown
        targetPages
      }
      errors
    }
  }
`)
