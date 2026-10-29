/** Explicit matching uses catalogue identities and owner-confirmed revisions, never browser prose. */
import { graphql } from '@/graphql/generated'

export const CHECK_JOB_BOARD_PREFERENCES = graphql(`
  mutation CheckJobBoardPreferences($listingId: ID!, $expectedDigest: String!, $confirmedRevision: Int!) {
    checkJobBoardPreferences(input: { listingId: $listingId, expectedDigest: $expectedDigest, confirmedRevision: $confirmedRevision }) {
      aiTask { id status result errorMessage }
      errors
    }
  }
`)
export const JOB_PREFERENCE_CHECK_SUBSCRIPTION = graphql(`
  subscription JobPreferenceCheck($id: ID!) {
    aiTaskUpdated(id: $id) { id status result errorMessage }
  }
`)
