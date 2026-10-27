/**
 * Description: GraphQL for the Home page (typed by GraphQL Code Generator).
 * Index:
 *   - JOB_PIPELINE_QUERY: every saved job, newest first, with Rails' suggested next step
 *   - RUNNING_AI_TASKS_QUERY: all of the user's AI work still in progress, with labels and links
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

export const RUNNING_AI_TASKS_QUERY = graphql(`
  query RunningAiTasks {
    runningAiTasks {
      id
      label
      destination
    }
  }
`)
