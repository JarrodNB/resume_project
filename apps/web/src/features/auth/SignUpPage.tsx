/**
 * Description: Sign-up page. New users go straight to importing their resume.
 * Index:
 *   - SignUpPage: page component
 */
import { Link, useNavigate } from 'react-router'
import type { AuthCredentials } from './authApi'
import { AuthForm } from './AuthForm'
import { AuthPageShell } from './AuthPageShell'
import { useAuth } from './useAuth'

/** Creates an account, then sends the user to the resume import page. */
export function SignUpPage() {
  const { signUp } = useAuth()
  const navigate = useNavigate()

  async function handleSignUp(credentials: AuthCredentials) {
    await signUp(credentials)
    navigate('/import', { replace: true })
  }

  return (
    <AuthPageShell
      title="Create your account"
      description="Start with your existing resume; we'll build your career library from it."
      footer={
        <span>
          Already have an account?{' '}
          <Link to="/sign-in" className="font-medium text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </span>
      }
    >
      <AuthForm submitLabel="Create account" includeName onSubmit={handleSignUp} />
    </AuthPageShell>
  )
}
