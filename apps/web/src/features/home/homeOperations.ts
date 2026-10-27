/**
 * Description: GraphQL for the Home page (typed by GraphQL Code Generator).
 * Index:
 *   - JOB_PIPELINE_QUERY: every saved job, newest first, with Rails' suggested next step
 */
import { graphql } from '@/graphql/generated'

export const JOB_PIPELINE_QUERY = graphql(`
  query JobPipeline {
    jobPipeline {
      nextStep
      job {
        id
        title
        company
        location
        stage
      }
    }
  }
`)
