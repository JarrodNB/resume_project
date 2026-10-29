/** Explicit generation and review operations; proposal content is never saved by page load. */
import { graphql } from '@/graphql/generated'

export const SUMMARY_GENERATION_QUERY = graphql(`
  query SummaryGeneration($targetKind: String!, $targetId: ID) {
    summaryGeneration(targetKind: $targetKind, targetId: $targetId) {
      stale
      aiTask { id status result errorMessage acceptedAt }
    }
  }
`)
export const START_SUMMARY_GENERATION_MUTATION = graphql(`
  mutation StartSummaryGeneration($targetKind: String!, $targetId: ID) {
    startSummaryGeneration(input: {targetKind: $targetKind, targetId: $targetId}) {
      aiTask { id status result errorMessage acceptedAt }
      errors
    }
  }
`)
export const ACCEPT_SUMMARY_GENERATION_MUTATION = graphql(`
  mutation AcceptSummaryGeneration($aiTaskId: ID!, $text: String!) {
    acceptSummaryGeneration(input: {aiTaskId: $aiTaskId, text: $text}) {
      aiTask { id status result errorMessage acceptedAt }
      errors
    }
  }
`)
export const DISCARD_SUMMARY_GENERATION_MUTATION = graphql(`
  mutation DiscardSummaryGeneration($aiTaskId: ID!) {
    discardSummaryGeneration(input: {aiTaskId: $aiTaskId}) {
      aiTask { id status result errorMessage acceptedAt }
      errors
    }
  }
`)
