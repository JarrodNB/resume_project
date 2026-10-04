/**
 * Description: GraphQL operations for saved jobs (typed by GraphQL Code Generator).
 * Index:
 *   - JOBS_QUERY: the user's jobs, newest first
 *   - JOB_QUERY: one job with its description, requirements, and latest gap analysis
 *   - SCRAPE_JOB_MUTATION: starts a scrape_job AI task for a job posting URL
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
      requirements
      niceToHaves
      latestGapAnalysis {
        id
        status
        result
        errorMessage
        createdAt
      }
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
