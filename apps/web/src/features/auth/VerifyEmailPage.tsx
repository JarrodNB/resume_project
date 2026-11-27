/** Automatically verifies a captured email link; never signs in, and supports resend after refresh.
 * After verifying, the Sign in button carries the confirmed email (returned by the API) in router
 * state, never the URL, so the sign-in form starts filled in. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { ErrorAlert } from '@/components/ErrorAlert'
import { AuthPageShell } from './AuthPageShell'
import { ResendConfirmationForm } from './ResendConfirmationForm'
import { AuthRequestError, verifyEmailRequest } from './authApi'
import { forgetConfirmationToken, readConfirmationToken } from './confirmationLink'
import { useAuth } from './useAuth'

export function VerifyEmailPage() {
  const { csrfToken } = useAuth()
  const [token, setToken] = useState(readConfirmationToken)
  const [pending, setPending] = useState(false)
  const [verified, setVerified] = useState(false)
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const started = useRef(false)
  const inFlight = useRef(false)
  const verify = useCallback(async () => {
    if (!token || inFlight.current) return
    inFlight.current = true
    setPending(true); setErrors([])
    try {
      const { email } = await verifyEmailRequest(token, csrfToken)
      forgetConfirmationToken(); setToken(null); setVerified(true); setVerifiedEmail(typeof email === 'string' ? email : null)
    } catch (error) { setErrors(error instanceof AuthRequestError ? error.messages : ['Could not reach the server. Try again, or request a new link if verification already completed.']) }
    finally { inFlight.current = false; setPending(false) }
  }, [token, csrfToken])

  useEffect(() => {
    if (started.current || !token) return
    started.current = true
    void verify()
  }, [token, verify])
  return <AuthPageShell title={verified ? 'Email verified' : token ? 'Verify your email' : 'Get a verification email'} description={verified ? 'Your account is ready. Sign in to start your job search.' : 'Finish creating your Careerdrafter account.'}
    footer={verified ? 'Grounded in your experience. Refined with you.' : <Link to="/sign-in" className="font-medium text-foreground underline underline-offset-4">Sign in</Link>}>
    <div className="grid gap-4">
      {errors.length > 0 && <ErrorAlert messages={errors} />}
      {verified ? <><p role="status" className="sr-only">Email verified. You can now sign in.</p><Button asChild size="lg" className="min-h-11"><Link to="/sign-in" state={verifiedEmail ? { email: verifiedEmail } : undefined}>Sign in</Link></Button></> : token ? <>
        <p role="status">{pending ? 'Verifying your email…' : 'Verification could not be completed. Try again or request a new link.'}</p>
        <Button size="lg" className="min-h-11" disabled={pending} onClick={verify}>{pending ? 'Verifying…' : 'Try again'}</Button>
        <Button variant="ghost" size="lg" className="min-h-11" disabled={pending} onClick={() => { forgetConfirmationToken(); setToken(null); setErrors([]) }}>Cancel</Button>
      </> : <p>Open the link in your email, or request another below. If you refreshed this page, reopen the email link.</p>}
      {!verified && !token && <ResendConfirmationForm />}
    </div>
  </AuthPageShell>
}
