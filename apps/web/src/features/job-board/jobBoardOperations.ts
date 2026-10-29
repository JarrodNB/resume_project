/** Typed server contracts for shared listing search and explicit private Job creation. */
import { graphql } from '@/graphql/generated'

export const JOB_BOARD_SEARCH_QUERY = graphql(`
  query JobBoardSearch($keyword: String!, $remoteOnly: Boolean!, $cursor: String, $experienceLevels: [JobBoardExperienceLevel!]!, $filters: JobBoardFiltersInput) {
    jobBoardSearch(keyword: $keyword, remoteOnly: $remoteOnly, cursor: $cursor, experienceLevels: $experienceLevels, filters: $filters) {
      listings {
        id
        preferenceSourceDigest
        title
        company
        location
        description
        remoteType
        published
        employmentType
        salaryText
        salaryCurrency
        hasRemote
        savedJob { id }
      }
      nextCursor
      retrievedAt
      stale
      errors
    }
  }
`)

export const IMPORT_JOB_BOARD_LISTING_MUTATION = graphql(`
  mutation ImportJobBoardListing($listingId: ID!) {
    importJobBoardListing(input: { listingId: $listingId }) {
      job { id }
      warnings
      errors
    }
  }
`)

/** Resolve place names through the authenticated API. */
export const JOB_BOARD_LOCATIONS_QUERY = graphql(`
  query JobBoardLocations($query: String!) {
    jobBoardLocations(query: $query) {
      locations { kind providerId label }
      errors
    }
  }
`)

export const RERANK_JOB_BOARD_LISTINGS_MUTATION = graphql(`
  mutation RerankJobBoardListings($keyword: String!, $listingIds: [ID!]!) {
    rerankJobBoardListings(input: { keyword: $keyword, listingIds: $listingIds }) {
      aiTask { id status result errorMessage }
      errors
    }
  }
`)

export const JOB_BOARD_RERANKING_SUBSCRIPTION = graphql(`
  subscription JobBoardReranking($id: ID!) {
    aiTaskUpdated(id: $id) { id status result errorMessage }
  }
`)

export const JOB_BOARD_SEARCH_IDEAS_QUERY = graphql(`
  query JobBoardSearchIdeas {
    me { id jobTitleSuggestions }
  }
`)
