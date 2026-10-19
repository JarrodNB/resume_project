/** Explicitly verifies a captured email link; never signs in, and supports resend after refresh. */
import { useState } from 'react'
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
  const [errors, setErrors] = useState<string[]>([])
  async function verify() {
    if (!token || pending) return
    setPending(true); setErrors([])
    try {
      await verifyEmailRequest(token, csrfToken)
      forgetConfirmationToken(); setToken(null); setVerified(true)
    } catch (error) { setErrors(error instanceof AuthRequestError ? error.messages : ['Could not reach the server. Try again, or request a new link if verification already completed.']) }
    finally { setPending(false) }
  }
  return <AuthPageShell title="Verify your email" description="Finish creating your Careergrind account."
    footer={<Link to="/sign-in" className="font-medium text-foreground underline underline-offset-4">Sign in</Link>}>
    <div className="grid gap-4">
      {errors.length > 0 && <ErrorAlert messages={errors} />}
      {verified ? <p role="status">Email verified. You can now sign in.</p> : token ? <>
        <p>Verify the email address from your link. This does not sign you in.</p>
        <Button size="lg" disabled={pending} onClick={verify}>{pending ? 'Verifying…' : 'Verify email'}</Button>
        <Button variant="outline" size="lg" disabled={pending} onClick={() => { forgetConfirmationToken(); setToken(null) }}>Cancel</Button>
      </> : <p>Open the link in your email, or request another below. If you refreshed this page, reopen the email link.</p>}
      {!verified && <ResendConfirmationForm />}
    </div>
  </AuthPageShell>
}
