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
