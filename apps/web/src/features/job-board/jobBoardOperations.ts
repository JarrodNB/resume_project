/** Typed server contracts for shared listing search and explicit private Job creation. */
import { graphql } from '@/graphql/generated'

export const JOB_BOARD_SEARCH_QUERY = graphql(`
  query JobBoardSearch($keyword: String!, $remoteOnly: Boolean!, $cursor: String, $experienceLevels: [JobBoardExperienceLevel!]!) {
    jobBoardSearch(keyword: $keyword, remoteOnly: $remoteOnly, cursor: $cursor, experienceLevels: $experienceLevels) {
      listings {
        id
        title
        company
        location
        description
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
