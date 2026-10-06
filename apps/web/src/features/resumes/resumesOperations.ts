/**
 * Description: GraphQL operations for saved resumes (typed by GraphQL Code Generator).
 * Index:
 *   - RESUMES_QUERY: the user's resumes, most recently updated first
 *   - RESUME_QUERY: one resume with its job and sections
 */
import { graphql } from '@/graphql/generated'

export const RESUMES_QUERY = graphql(`
  query Resumes {
    resumes {
      id
      title
      updatedAt
      job {
        id
        title
        company
      }
    }
  }
`)

export const RESUME_QUERY = graphql(`
  query Resume($id: ID!) {
    resume(id: $id) {
      id
      title
      job {
        id
        title
        company
      }
      sections {
        id
        sectionType
        title
        position
        content
      }
    }
  }
`)
