/** Owned guide reads are separate from ordinary job queries so guide bodies load only on demand. */
import { graphql } from '@/graphql/generated'

export const STUDY_GUIDE_QUERY = graphql(`
  query StudyGuideForJob($jobId: ID!, $cursor: String) {
    job(id: $jobId) {
      id
      studyGuideDescriptionFingerprint
      studyGuides(cursor: $cursor) { guides { id createdAt sourceDescriptionFingerprint outOfDate } nextCursor errors }
      latestStudyGuideTask { id status errorMessage createdAt }
    }
  }
`)

export const STUDY_GUIDE_CONTENT_QUERY = graphql(`
  query StudyGuideContent($jobId: ID!, $guideId: ID!) {
    job(id: $jobId) {
      id
      studyGuide(id: $guideId) { id result createdAt studyGuideOutOfDate }
    }
  }
`)

export const GENERATE_STUDY_GUIDE_MUTATION = graphql(`
  mutation GenerateStudyGuide($jobId: ID!) {
    generateStudyGuide(input: {jobId: $jobId}) {
      aiTask { id status errorMessage createdAt }
      errors
    }
  }
`)
