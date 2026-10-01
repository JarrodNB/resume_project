/**
 * Description: GraphQL operations for the career library (typed by GraphQL Code Generator).
 * Index:
 *   - CAREER_LIBRARY_QUERY: experiences, projects, educations, skills, and resumes in one request
 */
import { graphql } from '@/graphql/generated'

export const CAREER_LIBRARY_QUERY = graphql(`
  query CareerLibrary {
    experiences {
      id
      company
      title
      location
      startDate
      endDate
      description
      highlights {
        id
        content
      }
    }
    projects {
      id
      name
      role
      url
      startDate
      endDate
      description
    }
    educations {
      id
      institution
      degree
      fieldOfStudy
      startDate
      endDate
      description
    }
    skills {
      id
      name
      category
    }
    resumes {
      id
      title
      kind
      updatedAt
      sections {
        id
      }
    }
  }
`)
