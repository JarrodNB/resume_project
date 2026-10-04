/**
 * Description: GraphQL operations for the career library (typed by GraphQL Code Generator).
 * Index:
 *   - CAREER_LIBRARY_QUERY: profile, experiences, projects, educations, and skills in one request
 */
import { graphql } from '@/graphql/generated'

export const CAREER_LIBRARY_QUERY = graphql(`
  query CareerLibrary {
    me {
      id
      name
      contactEmail
      phone
      location
      links
      summary
    }
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
  }
`)
