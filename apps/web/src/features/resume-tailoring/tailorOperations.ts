/**
 * Description: GraphQL operations for writing a resume one section at a time.
 * Index:
 *   - TAILOR_JOB_QUERY: the job, its saved resume, and the newest tailoring task
 *   - START_RESUME_TAILORING_MUTATION / SUBMIT_TAILORED_SECTION_MUTATION / SAVE_TAILORED_RESUME_MUTATION
 *   - UPDATE_RESUME_MUTATION: replace the content of a saved resume's sections
 * Live status comes from features/ai-tasks (input and pendingQuestions on aiTaskUpdated).
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
        atsContentFingerprint
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
        pendingQuestions
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

export const SUBMIT_TAILORED_SECTION_MUTATION = graphql(`
  mutation SubmitTailoredSection($aiTaskId: ID!, $sectionType: String!, $action: String!, $content: JSON) {
    submitTailoredSection(input: { aiTaskId: $aiTaskId, sectionType: $sectionType, action: $action, content: $content }) {
      aiTask {
        id
        status
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
        atsContentFingerprint
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
