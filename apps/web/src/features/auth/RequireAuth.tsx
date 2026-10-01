/**
 * Description: Route guards for signed-in and signed-out areas of the app.
 * Index:
 *   - RequireAuth: renders child routes only when signed in, else redirects to /sign-in
 *   - RequireSignedOut: redirects home if the user arrives already signed in
 */
import { useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from './useAuth'

/** Redirects to /sign-in (remembering where the user was going) when there is no session. */
export function RequireAuth() {
  const { token } = useAuth()
  const location = useLocation()
  if (!token) return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />
  return <Outlet />
}

/**
 * Keeps users who arrive already signed in off the sign-in and sign-up pages. Signing in on
 * these pages doesn't trigger it, so the page itself decides where to go next.
 */
export function RequireSignedOut() {
  const { token } = useAuth()
  const [signedInOnArrival] = useState(token !== null)
  if (signedInOnArrival) return <Navigate to="/" replace />
  return <Outlet />
}
