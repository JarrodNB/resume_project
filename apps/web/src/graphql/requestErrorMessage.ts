/**
 * Description: Turns an error from an Apollo operation into a message for the user. The API
 * throttles requests (HTTP 429), which deserves its own message instead of "check your connection".
 * Index:
 *   - TOO_MANY_REQUESTS_MESSAGE: shown when the API rate-limits the user
 *   - REQUEST_TOO_LARGE_MESSAGE: shown when the API refuses a body over its size cap
 *   - OUTDATED_APP_MESSAGE: shown when the API no longer understands this page's operations
 *   - requestErrorMessage: returns the message for an error, or the fallback
 */
import { CombinedGraphQLErrors, ServerError } from '@apollo/client/errors'

export const TOO_MANY_REQUESTS_MESSAGE = 'Too many requests. Please wait a moment and try again.'
export const REQUEST_TOO_LARGE_MESSAGE = 'This request is too large'
export const OUTDATED_APP_MESSAGE = 'Careerdrafter was updated while this page was open. Reload the page to continue.'

/** graphql-ruby validation codes that mean the operation does not match the API's schema. */
const SCHEMA_MISMATCH_CODES = new Set([
  'undefinedField', 'argumentNotAccepted', 'missingRequiredArguments', 'missingRequiredInputObjectAttribute',
  'variableRequiresValidType', 'variableNotUsed', 'variableNotDefined', 'argumentLiteralsIncompatible',
  'inputObjectRequiresValidType', 'unknownArgument',
])

/**
 * Returns a specific message for HTTP 429 and 413, and for a page left open across a deploy
 * (its operations ask for fields the API has since removed); otherwise `fallback`.
 */
export function requestErrorMessage(error: unknown, fallback: string): string {
  if (ServerError.is(error) && error.statusCode === 429) return TOO_MANY_REQUESTS_MESSAGE
  if (ServerError.is(error) && error.statusCode === 413) return REQUEST_TOO_LARGE_MESSAGE
  if (CombinedGraphQLErrors.is(error) && error.errors.some((item) => SCHEMA_MISMATCH_CODES.has(String(item.extensions?.code)))) {
    return OUTDATED_APP_MESSAGE
  }
  return fallback
}
