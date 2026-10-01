/**
 * Description: REST calls to the Rails auth endpoints. Sign-in and sign-up return the JWT from
 * the Authorization response header.
 * Index:
 *   - AuthCredentials: email, password, and (for sign-up) name
 *   - AuthRequestError: failed auth request with user-facing messages
 *   - signInRequest: POST /auth/sign_in, returns the JWT
 *   - signUpRequest: POST /auth/sign_up, returns the JWT
 *   - signOutRequest: DELETE /auth/sign_out (revokes the JWT)
 */
import { API_URL } from '@/lib/apiConfig'

export interface AuthCredentials {
  email: string
  password: string
  name?: string
}

/** A failed auth request; `messages` are safe to show to the user. */
export class AuthRequestError extends Error {
  readonly messages: string[]

  constructor(messages: string[]) {
    super(messages.join(' '))
    this.name = 'AuthRequestError'
    this.messages = messages
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' }

/** Signs in and returns the JWT. Throws AuthRequestError on bad credentials. */
export function signInRequest(credentials: AuthCredentials): Promise<string> {
  return requestToken('/auth/sign_in', credentials)
}

/** Creates an account (already signed in) and returns the JWT. Throws AuthRequestError on validation errors. */
export function signUpRequest(credentials: AuthCredentials): Promise<string> {
  return requestToken('/auth/sign_up', credentials)
}

/** Revokes the JWT on the server. */
export async function signOutRequest(token: string): Promise<void> {
  await fetch(`${API_URL}/auth/sign_out`, {
    method: 'DELETE',
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` },
  })
}

/** Posts credentials to an auth endpoint and returns the JWT from the Authorization header. */
async function requestToken(path: string, credentials: AuthCredentials): Promise<string> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ user: credentials }),
  })
  if (!response.ok) throw new AuthRequestError(await readErrorMessages(response))

  const token = response.headers.get('Authorization')?.replace(/^Bearer /, '')
  if (!token) throw new AuthRequestError(['The server did not return a session token.'])
  return token
}

/** Reads Devise's `{ errors: [...] }` or `{ error: "..." }` body into a list of messages. */
async function readErrorMessages(response: Response): Promise<string[]> {
  const body: { errors?: string[]; error?: string } = await response.json().catch(() => ({}))
  if (body.errors?.length) return body.errors
  if (body.error) return [body.error]
  return [`Something went wrong (HTTP ${response.status}). Please try again.`]
}
