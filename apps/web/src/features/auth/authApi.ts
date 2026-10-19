/** Calls Rails account endpoints using browser cookies and Rails CSRF protection.
 * Only safe user details and a CSRF token are returned to JavaScript. */
import { API_URL } from '@/lib/apiConfig'

export interface AuthCredentials { email: string; password: string; name?: string }
export interface SessionUser { id: string; email: string; name: string | null }
export interface BrowserSession { user: SessionUser | null; csrfToken: string }

export class AuthRequestError extends Error {
  readonly messages: string[]
  constructor(messages: string[]) {
    super(messages.join(' '))
    this.name = 'AuthRequestError'
    this.messages = messages
  }
}
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' }

export async function sessionRequest(signal?: AbortSignal): Promise<BrowserSession> {
  const response = await fetch(`${API_URL}/auth/session`, { credentials: 'include', cache: 'no-store', signal })
  if (!response.ok) throw new AuthRequestError(await readErrorMessages(response))
  return response.json()
}
export function signInRequest(credentials: AuthCredentials, csrfToken: string): Promise<BrowserSession> {
  return requestSession('/auth/sign_in', credentials, csrfToken)
}
export function signUpRequest(credentials: AuthCredentials, csrfToken: string): Promise<BrowserSession> {
  return requestSession('/auth/sign_up', credentials, csrfToken)
}
export async function signOutRequest(csrfToken: string): Promise<void> {
  const response = await fetch(`${API_URL}/auth/sign_out`, {
    method: 'DELETE', credentials: 'include', headers: { ...JSON_HEADERS, 'X-CSRF-Token': csrfToken },
  })
  if (!response.ok) throw new AuthRequestError(await readErrorMessages(response))
}
async function requestSession(path: string, credentials: AuthCredentials, csrfToken: string): Promise<BrowserSession> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST', credentials: 'include', headers: { ...JSON_HEADERS, 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ user: credentials }),
  })
  if (!response.ok) throw new AuthRequestError(await readErrorMessages(response))
  return response.json()
}
async function readErrorMessages(response: Response): Promise<string[]> {
  const body: { errors?: string[]; error?: string } = await response.json().catch(() => ({}))
  if (body.errors?.length) return body.errors
  if (body.error) return [body.error]
  return [`Something went wrong (HTTP ${response.status}). Please try again.`]
}
