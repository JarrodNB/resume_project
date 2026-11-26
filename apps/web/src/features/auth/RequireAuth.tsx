/**
 * Description: Route guards for signed-in and signed-out areas of the app.
 * Index:
 *   - RequireAuth: renders child routes only when signed in, else redirects to /sign-in
 *   - RequireSignedOut: redirects home if the user arrives already signed in
 */
import { useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from './useAuth'

/** Redirects to /sign-in when there is no session. It remembers where the user was going, except
 * after a deliberate sign-out: the next person to sign in shouldn't land on the last user's page. */
export function RequireAuth() {
  const { user, signedOut } = useAuth()
  const location = useLocation()
  if (!user) return <Navigate to="/sign-in" replace state={signedOut ? null : { from: location.pathname }} />
  return <Outlet />
}

/**
 * Keeps users who arrive already signed in off the sign-in and sign-up pages. Signing in on
 * these pages doesn't trigger it, so the page itself decides where to go next.
 */
export function RequireSignedOut() {
  const { user } = useAuth()
  const [signedInOnArrival] = useState(user !== null)
  if (signedInOnArrival) return <Navigate to="/" replace />
  return <Outlet />
}
