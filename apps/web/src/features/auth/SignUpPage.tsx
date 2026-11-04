/** Requests an account after the bot check, then guides users to email verification without starting a session. */
import { useState } from 'react'
import { Link } from 'react-router'
import type { AuthCredentials } from './authApi'
import { AuthForm } from './AuthForm'
import { AuthPageShell } from './AuthPageShell'
import { useAuth } from './useAuth'
import { ResendConfirmationForm } from './ResendConfirmationForm'
import { TurnstileWidget } from './TurnstileWidget'

/** Requests an account without starting a session or disclosing duplicate emails. */
export function SignUpPage() {
  const { signUp } = useAuth()
  const [submitted, setSubmitted] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileAttempt, setTurnstileAttempt] = useState(0)

  async function handleSignUp(credentials: AuthCredentials) {
    if (!turnstileToken) return
    try {
      await signUp(credentials, turnstileToken)
      setSubmitted(true)
    } catch (error) {
      // The server may have spent this one-time token, so remounting fetches a new one.
      setTurnstileToken(null)
      setTurnstileAttempt((attempt) => attempt + 1)
      throw error
    }
  }

  return (
    <AuthPageShell
      title={submitted ? 'Check your email' : 'Create your account'}
      description={submitted ? 'One more step before you sign in.' : "Start with your existing resume; we'll build your career library from it."}
      footer={
        <span>
          Already have an account?{' '}
          <Link to="/sign-in" className="font-medium text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </span>
      }
    >
      {submitted ? <div className="grid gap-4"><p role="status">Check your email. If this address can be registered, a verification email will arrive shortly.</p><p className="text-sm leading-relaxed text-muted-foreground">Open the email and choose Verify email. Then return here to sign in. The link expires after 24 hours.</p><details className="auth-resend-disclosure"><summary>Didn't receive an email?</summary><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Check your spam folder first. Requesting another email replaces the previous link.</p><ResendConfirmationForm /></details></div>
        : <AuthForm submitLabel="Create account" includeName onSubmit={handleSignUp} submitDisabled={!turnstileToken} beforeSubmit={<TurnstileWidget key={turnstileAttempt} onTokenChange={setTurnstileToken} />} />}
    </AuthPageShell>
  )
}
