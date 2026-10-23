/** Upload an exact Word export for a short-lived, private pagination check. */
import { graphql } from '@/graphql/generated'
export const START_DOCX_CHECK = graphql(`
  mutation StartDocxCheck($file: Upload!, $contentDigest: String!, $resumeId: ID, $retryFailed: Boolean!) {
    startResumeDocxPageCheck(input: {file: $file, contentDigest: $contentDigest, resumeId: $resumeId, retryFailed: $retryFailed}) {
      check { id status contentDigest pageCount errorCode expiresAt }
      errors
    }
  }
`)
export const DOCX_CHECK = graphql(`
  query DocxCheck($id: ID!) {
    resumeDocxPageCheck(id: $id) { id status contentDigest pageCount errorCode expiresAt }
  }
`)
