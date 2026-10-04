/**
 * Description: GraphQL mutations that save drag-and-drop changes in the career library (typed by
 * GraphQL Code Generator). Roles, projects, and education are always listed by date, so only
 * skills and highlights are reordered by hand.
 * Index:
 *   - REORDER_SKILLS_MUTATION: new order for all of the user's skills
 *   - MOVE_EXPERIENCE_HIGHLIGHT_MUTATION: moves a highlight within or between roles; returns both
 *     roles' highlights so the cache matches the server
 */
import { graphql } from '@/graphql/generated'

export const REORDER_SKILLS_MUTATION = graphql(`
  mutation ReorderSkills($orderedIds: [ID!]!) {
    reorderSkills(input: { orderedIds: $orderedIds }) {
      errors
    }
  }
`)

export const MOVE_EXPERIENCE_HIGHLIGHT_MUTATION = graphql(`
  mutation MoveExperienceHighlight($highlightId: ID!, $experienceId: ID!, $position: Int!) {
    moveExperienceHighlight(input: { highlightId: $highlightId, experienceId: $experienceId, position: $position }) {
      experience {
        id
        highlights {
          id
          content
          position
        }
      }
      sourceExperience {
        id
        highlights {
          id
          content
          position
        }
      }
      errors
    }
  }
`)
