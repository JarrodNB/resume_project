/** Auth failures preserve the server's actionable, safe error messages. */
import { afterEach, expect, it, vi } from 'vitest'
import { AuthRequestError, signInRequest, signUpRequest } from './authApi'
afterEach(() => vi.unstubAllGlobals())
it.each([
  [401, { error: 'Invalid Email or password.' }, ['Invalid Email or password.']],
  [422, { errors: ['Email is invalid', 'Password is too short'] }, ['Email is invalid', 'Password is too short']],
  [429, { errors: ['Too many requests. Please try again in 12 seconds.'] }, ['Too many requests. Please try again in 12 seconds.']],
])('shows safe errors for HTTP %s', async (status, body, messages) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })))
  const error = await signInRequest({ email: 'a@b.c', password: 'x' }, 'csrf').catch((error) => error)
  expect(error).toBeInstanceOf(AuthRequestError)
  expect(error.messages).toEqual(messages)
})
it('handles non-JSON failures', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('oops', { status: 500 })))
  await expect(signUpRequest({ email: 'a@b.c', password: 'x' }, 'csrf')).rejects.toThrow('HTTP 500')
})
