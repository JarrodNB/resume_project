/**
 * Description: Turns an error from an Apollo operation into a message for the user. The API
 * throttles requests (HTTP 429), which deserves its own message instead of "check your connection".
 * Index:
 *   - TOO_MANY_REQUESTS_MESSAGE: shown when the API rate-limits the user
 *   - requestErrorMessage: returns the message for an error, or the fallback
 */
import { ServerError } from '@apollo/client/errors'

export const TOO_MANY_REQUESTS_MESSAGE = 'Too many requests. Please wait a moment and try again.'

/** Returns TOO_MANY_REQUESTS_MESSAGE for an HTTP 429, otherwise `fallback`. */
export function requestErrorMessage(error: unknown, fallback: string): string {
  if (ServerError.is(error) && error.statusCode === 429) return TOO_MANY_REQUESTS_MESSAGE
  return fallback
}
