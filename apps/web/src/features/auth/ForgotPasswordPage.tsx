/** Requests recovery mail without disclosing account existence or changing the current session. */
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ErrorAlert } from '@/components/ErrorAlert'
import { AuthPageShell } from './AuthPageShell'
import { AuthRequestError, requestPasswordReset } from './authApi'
import { useAuth } from './useAuth'

export function ForgotPasswordPage() {
  const { csrfToken } = useAuth()
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    setPending(true); setErrors([]); setMessage('')
    try { setMessage((await requestPasswordReset(email, csrfToken)).message) }
    catch (error) { setErrors(error instanceof AuthRequestError ? error.messages : ['Could not reach the server. Please try again.']) }
    finally { setPending(false) }
  }
  return <AuthPageShell title="Reset your password" description="We'll email a link if you have a verified account."
    footer={<Link to="/sign-in" className="underline underline-offset-4">Return to sign in</Link>}>
    <form className="grid gap-4" onSubmit={submit}>
      {errors.length > 0 && <ErrorAlert messages={errors} />}
      {message && <p role="status">{message}</p>}
      <div className="grid gap-2"><Label htmlFor="recovery-email">Email</Label>
        <Input id="recovery-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
      </div>
      <Button size="lg" disabled={pending}>{pending ? 'Sending…' : 'Send reset email'}</Button>
      <p className="text-sm text-muted-foreground">Links expire after six hours. Requesting another email replaces the previous link. If you have not verified your email, <Link to="/verify-email" className="underline underline-offset-4">request verification</Link>.</p>
    </form>
  </AuthPageShell>
}
