/**
 * Description: GraphQL operations for saved jobs (typed by GraphQL Code Generator).
 * Index:
 *   - JOBS_QUERY: the user's jobs, newest first
 *   - JOB_QUERY: one job with its description, requirements, notes, gap responses, and latest gap analysis
 *   - SCRAPE_JOB_MUTATION: starts a scrape_job AI task for a job posting URL
 *   - CREATE_JOB_MUTATION, UPDATE_JOB_MUTATION: manual add and edit
 *   - MOVE_JOB_TO_STAGE_MUTATION: application stage, including the first applied date
 *   - DELETE_JOB_MUTATION: removes the job; a tailored resume stays, unlinked
 * Live task status comes from features/ai-tasks.
 */
import { graphql } from '@/graphql/generated'

export const JOBS_QUERY = graphql(`
  query Jobs {
    jobs {
      id
      title
      company
      location
      stage
      createdAt
    }
  }
`)

export const JOB_QUERY = graphql(`
  query Job($id: ID!) {
    job(id: $id) {
      id
      title
      company
      location
      stage
      url
      description
      notes
      appliedAt
      requirements
      niceToHaves
      gapResponses {
        id
        requirement
        body
        libraryFact {
          id
        }
      }
      latestGapAnalysis {
        id
        status
        result
        errorMessage
        createdAt
      }
      resume {
        id
      }
    }
  }
`)

export const CREATE_JOB_MUTATION = graphql(`
  mutation CreateJob($attributes: JobAttributesInput!) {
    createJob(input: { attributes: $attributes }) {
      job {
        id
      }
      errors
    }
  }
`)

export const UPDATE_JOB_MUTATION = graphql(`
  mutation UpdateJob($id: ID!, $attributes: JobAttributesInput!) {
    updateJob(input: { id: $id, attributes: $attributes }) {
      errors
    }
  }
`)

export const MOVE_JOB_TO_STAGE_MUTATION = graphql(`
  mutation MoveJobToStage($id: ID!, $stage: JobStageEnum!) {
    moveJobToStage(input: { id: $id, stage: $stage }) {
      errors
    }
  }
`)

export const DELETE_JOB_MUTATION = graphql(`
  mutation DeleteJob($id: ID!) {
    deleteJob(input: { id: $id }) {
      errors
    }
  }
`)

export const SCRAPE_JOB_MUTATION = graphql(`
  mutation ScrapeJob($url: String!) {
    scrapeJob(input: { url: $url }) {
      aiTask {
        id
        status
      }
      errors
    }
  }
`)
