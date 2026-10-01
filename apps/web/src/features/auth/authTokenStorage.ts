/**
 * Description: Persists the signed-in user's JWT in localStorage.
 * Index:
 *   - readAuthToken: returns the stored JWT, or null
 *   - saveAuthToken: stores a JWT
 *   - clearAuthToken: removes the stored JWT
 */

const AUTH_TOKEN_KEY = 'throughline.authToken'

/** Returns the stored JWT, or null when signed out. */
export function readAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY)
}

/** Stores the JWT (without the "Bearer " prefix). */
export function saveAuthToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token)
}

/** Removes the stored JWT. */
export function clearAuthToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY)
}
