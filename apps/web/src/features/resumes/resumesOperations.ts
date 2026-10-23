/**
 * Loads saved resumes and removes an owned resume through the API.
 * GraphQL Code Generator supplies the operation and response types.
 */
import { graphql } from '@/graphql/generated'

export const DELETE_RESUME_MUTATION = graphql(`
  mutation DeleteResume($id: ID!) {
    deleteResume(input: { id: $id }) {
      resume {
        id
      }
      errors
    }
  }
`)

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
      markdown
      targetPages
    }
  }
`)
