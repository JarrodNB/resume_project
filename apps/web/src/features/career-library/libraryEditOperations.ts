/** Owned individual editing operations; saved model history never comes from the browser. */
import { graphql } from '@/graphql/generated'

export const LIBRARY_EDIT_QUERY = graphql(`
  query LibraryEdit($kind: String!, $recordId: ID!) {
    libraryEdit(kind: $kind, recordId: $recordId) {
      stale
      aiTask { id status result input pendingQuestions errorMessage acceptedAt }
    }
  }
`)

export const START_LIBRARY_EDIT_MUTATION = graphql(`
  mutation StartLibraryEdit($kind: String, $recordId: ID, $feedback: String!, $previousTaskId: ID, $skip: Boolean!) {
    startLibraryEdit(input: {kind: $kind, recordId: $recordId, feedback: $feedback, previousTaskId: $previousTaskId, skip: $skip}) {
      aiTask { id status result input pendingQuestions errorMessage acceptedAt }
      errors
    }
  }
`)

export const ACCEPT_LIBRARY_EDIT_MUTATION = graphql(`
  mutation AcceptLibraryEdit($aiTaskId: ID!) {
    acceptLibraryEdit(input: {aiTaskId: $aiTaskId}) {
      aiTask { id status result input pendingQuestions errorMessage acceptedAt }
      errors
    }
  }
`)

export const DISCARD_LIBRARY_EDIT_MUTATION = graphql(`
  mutation DiscardLibraryEdit($aiTaskId: ID!) {
    discardLibraryEdit(input: {aiTaskId: $aiTaskId}) { aiTask { id status } errors }
  }
`)

export const ANSWER_LIBRARY_REVIEW_MUTATION = graphql(`
  mutation AnswerLibraryReview($reviewTaskId: ID!, $kind: String!, $recordId: ID!, $answer: String!) {
    answerLibraryReview(input: {reviewTaskId: $reviewTaskId, kind: $kind, recordId: $recordId, answer: $answer}) {
      aiTask { id status result input pendingQuestions errorMessage acceptedAt }
      errors
    }
  }
`)
