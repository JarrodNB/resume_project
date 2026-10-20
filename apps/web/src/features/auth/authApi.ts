/** Calls Rails account endpoints using browser cookies and Rails CSRF protection.
 * Only safe user details and a CSRF token are returned to JavaScript. */
import { API_URL } from '@/lib/apiConfig'

export interface AuthCredentials { email: string; password: string; name?: string }
export interface SessionUser { id: string; email: string; name: string | null }
export interface BrowserSession { user: SessionUser | null; csrfToken: string }

export class AuthRequestError extends Error {
  readonly messages: string[]
  readonly status?: number
  constructor(messages: string[], status?: number) {
    super(messages.join(' '))
    this.name = 'AuthRequestError'
    this.messages = messages
    this.status = status
  }
}
// Account pages and GraphQL share a provider, but REST failures arrive outside Apollo.
const invalidCsrfListeners = new Set<() => void>()
/** Refresh session state after an explicit CSRF rejection; never replay the write. */
export function onInvalidCsrf(listener: () => void): () => void {
  invalidCsrfListeners.add(listener)
  return () => { invalidCsrfListeners.delete(listener) }
}
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' }

export async function sessionRequest(signal?: AbortSignal): Promise<BrowserSession> {
  const response = await fetch(`${API_URL}/auth/session`, { credentials: 'include', cache: 'no-store', signal })
  if (!response.ok) throw new AuthRequestError(await readErrorMessages(response), response.status)
  return response.json()
}
export function signInRequest(credentials: AuthCredentials, csrfToken: string): Promise<BrowserSession> {
  return requestSession('/auth/sign_in', credentials, csrfToken)
}
export function signUpRequest(credentials: AuthCredentials, csrfToken: string): Promise<{ message: string }> {
  return accountRequest('/auth/sign_up', { user: credentials }, csrfToken)
}
export function resendConfirmationRequest(email: string, csrfToken: string): Promise<{ message: string }> {
  return accountRequest('/auth/confirmation', { user: { email } }, csrfToken)
}
export function verifyEmailRequest(token: string, csrfToken: string): Promise<{ message: string }> {
  return accountRequest('/auth/confirmation/verify', { confirmation_token: token }, csrfToken)
}
export function requestPasswordReset(email: string, csrfToken: string): Promise<{ message: string }> {
  return accountRequest('/auth/password', { user: { email } }, csrfToken)
}
export function resetPasswordRequest(token: string, password: string, confirmation: string, csrfToken: string): Promise<{ message: string }> {
  return accountRequest('/auth/password', { user: { reset_password_token: token, password, password_confirmation: confirmation } }, csrfToken, 'PUT')
}
export function changePasswordRequest(current: string, password: string, confirmation: string, csrfToken: string): Promise<{ message: string }> {
  return accountRequest('/auth/password/change', { user: { current_password: current, password, password_confirmation: confirmation } }, csrfToken, 'PATCH')
}
async function accountRequest(path: string, body: unknown, csrfToken: string, method = 'POST'): Promise<{ message: string }> {
  const response = await fetch(`${API_URL}${path}`, {
    method, credentials: 'include', headers: { ...JSON_HEADERS, 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new AuthRequestError(await readErrorMessages(response), response.status)
  return response.json()
}
export async function signOutRequest(csrfToken: string): Promise<void> {
  const response = await fetch(`${API_URL}/auth/sign_out`, {
    method: 'DELETE', credentials: 'include', headers: { ...JSON_HEADERS, 'X-CSRF-Token': csrfToken },
  })
  if (!response.ok) throw new AuthRequestError(await readErrorMessages(response), response.status)
}
async function requestSession(path: string, credentials: AuthCredentials, csrfToken: string): Promise<BrowserSession> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST', credentials: 'include', headers: { ...JSON_HEADERS, 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ user: credentials }),
  })
  if (!response.ok) throw new AuthRequestError(await readErrorMessages(response), response.status)
  return response.json()
}
async function readErrorMessages(response: Response): Promise<string[]> {
  const body: { code?: string; errors?: string[]; error?: string } = await response.json().catch(() => ({}))
  if (response.status === 422 && body.code === 'invalid_csrf') invalidCsrfListeners.forEach((listener) => listener())
  if (body.errors?.length) return body.errors
  if (body.error) return [body.error]
  return [`Something went wrong (HTTP ${response.status}). Please try again.`]
}
