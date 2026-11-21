/**
 * Description: Tests for the user-facing message picked for Apollo request errors.
 */
import { CombinedGraphQLErrors, ServerError } from '@apollo/client/errors'
import { describe, expect, it } from 'vitest'
import { OUTDATED_APP_MESSAGE, REQUEST_TOO_LARGE_MESSAGE, TOO_MANY_REQUESTS_MESSAGE, requestErrorMessage } from './requestErrorMessage'

function serverError(status: number) {
  return new ServerError('Response not successful', {
    response: new Response('{}', { status }),
    bodyText: '{}',
  })
}

describe('requestErrorMessage', () => {
  it('explains an HTTP 429 as rate limiting', () => {
    expect(requestErrorMessage(serverError(429), 'fallback')).toBe(TOO_MANY_REQUESTS_MESSAGE)
  })

  it('explains an HTTP 413 as a request that is too large', () => {
    expect(requestErrorMessage(serverError(413), 'fallback')).toBe(REQUEST_TOO_LARGE_MESSAGE)
  })

  it('tells the user to reload when the API rejects a field the page still asks for', () => {
    const error = new CombinedGraphQLErrors({
      errors: [{ message: "Field 'preferenceSourceDigest' doesn't exist on type 'JobBoardListing'", extensions: { code: 'undefinedField' } }],
    })
    expect(requestErrorMessage(error, 'fallback')).toBe(OUTDATED_APP_MESSAGE)
  })

  it('uses the fallback for other GraphQL errors', () => {
    const error = new CombinedGraphQLErrors({ errors: [{ message: 'Record not found' }] })
    expect(requestErrorMessage(error, 'fallback')).toBe('fallback')
  })

  it('uses the fallback for other server errors', () => {
    expect(requestErrorMessage(serverError(500), 'fallback')).toBe('fallback')
  })

  it('uses the fallback for network failures', () => {
    expect(requestErrorMessage(new TypeError('Failed to fetch'), 'fallback')).toBe('fallback')
  })
})
