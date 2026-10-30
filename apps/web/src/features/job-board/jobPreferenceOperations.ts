/** Owner-scoped preference drafts and explicit confirmation share a version fence. */
import { graphql } from '@/graphql/generated'

export const JOB_PREFERENCES_QUERY = graphql(`
  query JobPreferences {
    jobPreferences { version confirmedRevision draftCriteria { id text priority } confirmedCriteria { id text priority } }
  }
`)

export const SAVE_JOB_PREFERENCE_DRAFT = graphql(`
  mutation SaveJobPreferenceDraft($expectedVersion: Int!, $criteria: [JobPreferenceCriterionInput!]!) {
    saveJobPreferenceDraft(input: { expectedVersion: $expectedVersion, criteria: $criteria }) {
      profile { version confirmedRevision draftCriteria { id text priority } confirmedCriteria { id text priority } }
      errors
    }
  }
`)

export const CONFIRM_JOB_PREFERENCES = graphql(`
  mutation ConfirmJobPreferences($expectedVersion: Int!) {
    confirmJobPreferences(input: { expectedVersion: $expectedVersion }) {
      profile { version confirmedRevision draftCriteria { id text priority } confirmedCriteria { id text priority } }
      errors
    }
  }
`)

export const CLEAR_JOB_PREFERENCES = graphql(`
  mutation ClearJobPreferences($expectedVersion: Int!) {
    clearJobPreferences(input: { expectedVersion: $expectedVersion }) {
      profile { version confirmedRevision draftCriteria { id text priority } confirmedCriteria { id text priority } }
      errors
    }
  }
`)
