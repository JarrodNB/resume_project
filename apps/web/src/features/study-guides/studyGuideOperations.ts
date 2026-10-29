/** Owned guide reads are separate from ordinary job queries so guide bodies load only on demand. */
import { graphql } from '@/graphql/generated'

export const GENERATE_STUDY_GUIDE_MUTATION = graphql(`
  mutation GenerateStudyGuide($jobId: ID!) {
    generateStudyGuide(input: {jobId: $jobId}) {
      aiTask { id status errorMessage createdAt studyGuideRetryAfterSeconds }
      errors
    }
  }
`)

export const STUDY_QUESTION_COLLECTION_QUERY = graphql(`
  query StudyQuestionCollection($jobId: ID!, $cursor: String) {
    job(id: $jobId) {
      id
      studyGuideDescriptionFingerprint
      studyQuestionBatches(cursor: $cursor) {
        batches { id result sourceDescriptionFingerprint outOfDate }
        endCursor totalQuestions errors
      }
      latestStudyGuideTask { id status errorMessage createdAt studyGuideRetryAfterSeconds }
    }
  }
`)
