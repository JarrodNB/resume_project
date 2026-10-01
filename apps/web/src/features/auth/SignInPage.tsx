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
      <AuthForm submitLabel="Sign in" onSubmit={handleSignIn} />
    </AuthPageShell>
  )
}
