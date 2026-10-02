/**
 * Description: Tests for the REST auth calls (token extraction and error messages).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthRequestError, signInRequest, signUpRequest } from './authApi'

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('signInRequest', () => {
  it('posts the credentials and returns the JWT without the Bearer prefix', async () => {
    const fetchMock = stubFetch(new Response('{}', { status: 200, headers: { Authorization: 'Bearer abc.def' } }))

    await expect(signInRequest({ email: 'ada@example.com', password: 'secret' })).resolves.toBe('abc.def')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3000/auth/sign_in')
    expect(JSON.parse(init.body)).toEqual({ user: { email: 'ada@example.com', password: 'secret' } })
  })

  it("throws Devise's error message on bad credentials", async () => {
    stubFetch(new Response(JSON.stringify({ error: 'Invalid Email or password.' }), { status: 401 }))

    const error = await signInRequest({ email: 'ada@example.com', password: 'wrong' }).catch((caught) => caught)
    expect(error).toBeInstanceOf(AuthRequestError)
    expect(error.messages).toEqual(['Invalid Email or password.'])
  })
})

describe('signUpRequest', () => {
  it('throws every validation error', async () => {
    stubFetch(new Response(JSON.stringify({ errors: ['Email is invalid', 'Password is too short'] }), { status: 422 }))

    const error = await signUpRequest({ email: 'bad', password: 'x' }).catch((caught) => caught)
    expect(error.messages).toEqual(['Email is invalid', 'Password is too short'])
  })

  it('shows the rate limit message when the API throttles the request', async () => {
    stubFetch(
      new Response(JSON.stringify({ errors: ['Too many requests. Please try again in 12 seconds.'] }), { status: 429 }),
    )

    const error = await signUpRequest({ email: 'a@b.c', password: 'password123' }).catch((caught) => caught)
    expect(error.messages).toEqual(['Too many requests. Please try again in 12 seconds.'])
  })

  it('falls back to a generic message when the body is not JSON', async () => {
    stubFetch(new Response('oops', { status: 500 }))

    const error = await signUpRequest({ email: 'a@b.c', password: 'password123' }).catch((caught) => caught)
    expect(error.messages).toEqual(['Something went wrong (HTTP 500). Please try again.'])
  })
})
