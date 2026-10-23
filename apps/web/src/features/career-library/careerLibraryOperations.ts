/**
 * Description: GraphQL operations for the career library (typed by GraphQL Code Generator).
 * Index:
 *   - CAREER_LIBRARY_QUERY: profile, experiences, projects, educations, certifications, skills, and library facts
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
    }
    experiences {
      id
      company
      title
      location
      startDate
      endDate
      description
      roles {
        id
        title
        startDate
        endDate
        description
        position
      }
      highlights {
        id
        content
        experienceRoleId
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
    libraryFacts {
      id
      requirement
      response
    }
  }
`)
