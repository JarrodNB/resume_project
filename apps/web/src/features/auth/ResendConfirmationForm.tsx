/** Lets anyone retry verification delivery without revealing account existence. */
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ErrorAlert } from '@/components/ErrorAlert'
import { AuthRequestError, resendConfirmationRequest } from './authApi'
import { useAuth } from './useAuth'

export function ResendConfirmationForm() {
  const { csrfToken } = useAuth()
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setPending(true); setErrors([]); setMessage('')
    try { setMessage((await resendConfirmationRequest(email, csrfToken)).message) }
    catch (error) { setErrors(error instanceof AuthRequestError ? error.messages : ['Could not reach the server. Please try again.']) }
    finally { setPending(false) }
  }
  return <form onSubmit={submit} className="auth-resend-form grid gap-4" aria-busy={pending}>
    {message && <p role="status">{message}</p>}
    {errors.length > 0 && <ErrorAlert messages={errors} />}
    <div className="grid gap-2"><Label htmlFor="resend-email">Email</Label><Input id="resend-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></div>
    <Button size="lg" type="submit" disabled={pending}>{pending ? 'Sending…' : 'Resend verification email'}</Button>
  </form>
}
