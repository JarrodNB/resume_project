/** Owned guide reads are separate from ordinary job queries so guide bodies load only on demand. */
import { graphql } from '@/graphql/generated'

export const STUDY_GUIDE_QUERY = graphql(`
  query StudyGuideForJob($jobId: ID!) {
    job(id: $jobId) {
      id
      latestStudyGuide { id status result errorMessage createdAt }
      latestStudyGuideTask { id status result errorMessage createdAt }
    }
  }
`)

export const GENERATE_STUDY_GUIDE_MUTATION = graphql(`
  mutation GenerateStudyGuide($jobId: ID!) {
    generateStudyGuide(input: {jobId: $jobId}) {
      aiTask { id status result errorMessage createdAt }
      errors
    }
  }
`)
