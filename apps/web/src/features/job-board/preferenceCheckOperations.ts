/** Explicit matching uses catalogue identities and owner-confirmed revisions, never browser prose. */
import { graphql } from '@/graphql/generated'

export const JOB_PREFERENCE_CHECK_SUBSCRIPTION = graphql(`
  subscription JobPreferenceCheck($id: ID!) {
    aiTaskUpdated(id: $id) { id status result errorMessage }
  }
`)

export const CHECK_JOB_BOARD_PREFERENCE_RESULTS = graphql(`
  mutation CheckJobBoardPreferenceResults($listings: [JobPreferenceListingInput!]!, $confirmedRevision: Int!) {
    checkJobBoardPreferenceResults(input: { listings: $listings, confirmedRevision: $confirmedRevision }) {
      aiTask { id status result errorMessage }
      errors
    }
  }
`)
