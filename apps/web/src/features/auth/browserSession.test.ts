/** Browser requests carry cookies and a Rails CSRF token, never a bearer credential. */
import { afterEach, expect, it, vi } from 'vitest'
import { signInRequest, signOutRequest } from './authApi'
afterEach(() => vi.unstubAllGlobals())
it('signs in with credentials and returns safe session data', async () => {
  const session = { user: { id: '1', email: 'ada@example.com', name: 'Ada' }, csrfToken: 'new-csrf' }
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(session)))
  vi.stubGlobal('fetch', fetch)
  await expect(signInRequest({ email: 'ada@example.com', password: 'secret' }, 'csrf')).resolves.toEqual(session)
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/auth/sign_in'), expect.objectContaining({
    credentials: 'include', headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf' }),
  }))
  expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('Authorization')
})
it('reports failed logout instead of claiming revocation succeeded', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })))
  await expect(signOutRequest('csrf')).rejects.toThrow()
})
