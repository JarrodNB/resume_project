/** Section-scoped review requests and saved assessments with optional enrichment questions. */
import { graphql } from '@/graphql/generated'

export const LIBRARY_REVIEW_QUERY = graphql(`
  query LibraryReview($section: String!) {
    libraryReview(section: $section) {
      aiTask { id status errorMessage }
      assessments { kind recordId field color reason question questions reviewTaskId stale }
    }
  }
`)

export const REVIEW_LIBRARY_SECTION_MUTATION = graphql(`
  mutation ReviewLibrarySection($section: String!) {
    reviewLibrarySection(input: { section: $section }) {
      aiTask { id status errorMessage }
      errors
    }
  }
`)
