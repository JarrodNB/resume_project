/** Safe owner-scoped task outcomes. A message without an outcome confirms registration. */
import { graphql } from '@/graphql/generated'

export const TASK_OUTCOME_SUBSCRIPTION = graphql(`
  subscription TaskOutcome {
    aiTaskFinished {
      cursor
      outcome {
        id
        taskId
        status
        title
        destination
        completedAt
      }
    }
  }
`)

export const TASK_OUTCOMES_QUERY = graphql(`
  query TaskOutcomes($after: String!, $through: String!) {
    taskOutcomes(after: $after, through: $through) {
      cursor
      hasMore
      outcomes {
        id
        taskId
        status
        title
        destination
        completedAt
      }
    }
  }
`)
