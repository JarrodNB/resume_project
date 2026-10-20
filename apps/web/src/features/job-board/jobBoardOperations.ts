/** Typed server contracts for shared listing search and explicit private Job creation. */
import { graphql } from '@/graphql/generated'

export const JOB_BOARD_SEARCH_QUERY = graphql(`
  query JobBoardSearch($keyword: String!, $remoteOnly: Boolean!, $cursor: String) {
    jobBoardSearch(keyword: $keyword, remoteOnly: $remoteOnly, cursor: $cursor) {
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
