/**
 * Description: Sign-in page. After signing in, returns the user to the page they were sent from.
 * Index:
 *   - SignInPage: page component
 */
import { Link, useLocation, useNavigate } from 'react-router'
import type { AuthCredentials } from './authApi'
import { AuthForm } from './AuthForm'
import { AuthPageShell } from './AuthPageShell'
import { useAuth } from './useAuth'

/** Signs the user in, then navigates to the originally requested page (or home). */
export function SignInPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = (location.state as { from?: string } | null)?.from ?? '/'
  const notice = (location.state as { notice?: string } | null)?.notice

  async function handleSignIn(credentials: AuthCredentials) {
    await signIn(credentials)
    navigate(returnTo, { replace: true })
  }

  return (
    <AuthPageShell
      title="Welcome back"
      description="Sign in to continue your job search."
      footer={
        <span>
          New here?{' '}
          <Link to="/sign-up" className="font-medium text-foreground underline underline-offset-4">
            Create an account
          </Link>
        </span>
      }
    >
      {notice && <p role="status" className="mb-4">{notice}</p>}
      <AuthForm submitLabel="Sign in" onSubmit={handleSignIn} />
      <Link to="/forgot-password" className="mt-4 inline-flex min-h-11 items-center text-sm underline underline-offset-4">Forgot your password?</Link>
      <Link to="/verify-email" className="mt-4 inline-flex min-h-11 items-center text-sm underline underline-offset-4">Need a verification email?</Link>
    </AuthPageShell>
  )
}
