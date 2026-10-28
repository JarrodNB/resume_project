/**
 * Description: GraphQL operations for the career library (typed by GraphQL Code Generator).
 * Index:
 *   - CAREER_LIBRARY_QUERY: profile, experiences, projects, educations, certifications, skills, and library career context entries
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
      links {
        label
        url
      }
      summary
      includeSummary
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
        position
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
    certifications {
      id
      name
      issuer
      issuedDate
      issuedDatePrecision
      expiryDate
      expiryDatePrecision
      credentialId
      credentialUrl
      description
    }
    skills {
      id
      name
      category
      position
    }
    careerContexts {
      id
      requirement
      response
    }
  }
`)
