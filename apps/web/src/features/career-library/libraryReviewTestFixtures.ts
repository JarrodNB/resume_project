/** Empty saved review for library tests that exercise unrelated editing controls. */
import { LIBRARY_REVIEW_QUERY } from './libraryReviewOperations'

export const emptyExperienceReviewMock = {
  request: { query: LIBRARY_REVIEW_QUERY, variables: { section: 'experience' } },
  result: { data: { libraryReview: { __typename: 'LibraryReview', aiTask: null, assessments: [] } } },
  maxUsageCount: Number.POSITIVE_INFINITY,
}

/** Every supported section has independent review state. */
export const emptyLibraryReviewMocks = ['experience', 'summary', 'projects', 'facts'].map((section) => ({
  ...emptyExperienceReviewMock,
  request: { query: LIBRARY_REVIEW_QUERY, variables: { section } },
}))
