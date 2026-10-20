/**
 * Description: Sign-up page. New users verify their email before signing in.
 * Index:
 *   - SignUpPage: page component
 */
import { useState } from 'react'
import { Link } from 'react-router'
import type { AuthCredentials } from './authApi'
import { AuthForm } from './AuthForm'
import { AuthPageShell } from './AuthPageShell'
import { useAuth } from './useAuth'
import { ResendConfirmationForm } from './ResendConfirmationForm'

/** Requests an account without starting a session or disclosing duplicate emails. */
export function SignUpPage() {
  const { signUp } = useAuth()
  const [submitted, setSubmitted] = useState(false)

  async function handleSignUp(credentials: AuthCredentials) {
    await signUp(credentials)
    setSubmitted(true)
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
      {submitted ? <div className="grid gap-4"><p role="status">Check your email. If this address can be registered, a verification email will arrive shortly. Check spam, or request another email below.</p><ResendConfirmationForm /></div>
        : <AuthForm submitLabel="Create account" includeName onSubmit={handleSignUp} />}
    </AuthPageShell>
  )
}
