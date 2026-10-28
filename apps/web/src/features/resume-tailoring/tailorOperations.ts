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
        includeSummary
        sections {
          id
          sectionType
          title
          position
          content
        }
      }
      latestTailoring {
        id
        status
        acceptedAt
        result
        input
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
        input
      }
      errors
    }
  }
`)

export const SAVE_TAILORED_RESUME_MUTATION = graphql(`
  mutation SaveTailoredResume($aiTaskId: ID!, $sections: JSON, $includeSummary: Boolean) {
    saveTailoredResume(input: { aiTaskId: $aiTaskId, sections: $sections, includeSummary: $includeSummary }) {
      resume {
        id
        title
      }
      errors
    }
  }
`)

export const UPDATE_RESUME_MUTATION = graphql(`
  mutation UpdateResume($id: ID!, $sections: JSON!, $includeSummary: Boolean) {
    updateResume(input: { id: $id, sections: $sections, includeSummary: $includeSummary }) {
      resume {
        id
        title
        includeSummary
        sections {
          id
          sectionType
          title
          position
          content
        }
      }
      errors
    }
  }
`)
