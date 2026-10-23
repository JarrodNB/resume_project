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
        targetPageCount
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
        input
        result
        errorMessage
      }
    }
  }
`)

export const START_RESUME_TAILORING_MUTATION = graphql(`
  mutation StartResumeTailoring($jobId: ID!, $targetPageCount: Int!) {
    startResumeTailoring(input: { jobId: $jobId, targetPageCount: $targetPageCount }) {
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
  mutation SaveTailoredResume($aiTaskId: ID!, $sections: JSON) {
    saveTailoredResume(input: { aiTaskId: $aiTaskId, sections: $sections }) {
      resume {
        id
        title
      }
      errors
    }
  }
`)

export const UPDATE_RESUME_MUTATION = graphql(`
  mutation UpdateResume($id: ID!, $sections: JSON!) {
    updateResume(input: { id: $id, sections: $sections }) {
      resume {
        id
        title
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
