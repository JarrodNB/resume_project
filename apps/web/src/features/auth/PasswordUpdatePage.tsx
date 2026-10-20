/** Collects a replacement password for recovery or a signed-in account change.
 * Tokens stay in memory, server validation owns policy, and success refreshes every tab's session. */
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ErrorAlert } from '@/components/ErrorAlert'
import { AuthPageShell } from './AuthPageShell'
import { PasswordInput } from './PasswordInput'
import { AuthRequestError, changePasswordRequest, resetPasswordRequest } from './authApi'
import { forgetResetPasswordToken, readResetPasswordToken } from './resetPasswordLink'
import { useAuth } from './useAuth'

export function PasswordUpdatePage({ change = false }: { change?: boolean }) {
  const { csrfToken, expireSession } = useAuth()
  const navigate = useNavigate()
  const [token] = useState(readResetPasswordToken)
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [pending, setPending] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending || (!change && !token)) return
    setPending(true); setErrors([])
    try {
      if (change) await changePasswordRequest(current, password, confirmation, csrfToken)
      else await resetPasswordRequest(token!, password, confirmation, csrfToken)
      forgetResetPasswordToken()
      setCurrent(''); setPassword(''); setConfirmation('')
      navigate('/password-updated', { replace: true })
      expireSession(true)
    } catch (error) {
      if (change && error instanceof AuthRequestError && error.status === 401) {
        navigate('/sign-in', { replace: true, state: { notice: 'Your session expired. Sign in again to change your password.' } })
        expireSession(true)
      } else {
        setErrors(error instanceof AuthRequestError ? error.messages : ['Could not reach the server. Try again. If your password already changed, sign in with the new password.'])
      }
    }
    finally { setPending(false) }
  }
  return <AuthPageShell title={change ? 'Change your password' : 'Choose a new password'}
    description="A successful change signs this account out everywhere. Sign in again afterward."
    footer={<Link to={change ? '/library' : '/sign-in'} className="underline underline-offset-4">{change ? 'Return to workspace' : 'Return to sign in'}</Link>}>
    {!change && !token ? <p>Open your reset email link again, or request a new one below. Refreshing this page clears the link for your privacy.</p> : <form onSubmit={submit} className="grid gap-4">
      {errors.length > 0 && <div id="password-update-errors"><ErrorAlert messages={errors} /></div>}
      {change && <div className="grid gap-2"><Label htmlFor="current-password">Current password</Label>
        <PasswordInput id="current-password" autoComplete="current-password" required value={current} onChange={(event) => setCurrent(event.target.value)} aria-describedby={errors.length ? 'password-update-errors' : undefined} />
      </div>}
      <div className="grid gap-2"><Label htmlFor="new-password">New password</Label>
        <PasswordInput id="new-password" autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby={`new-password-guidance${errors.length ? ' password-update-errors' : ''}`} aria-invalid={errors.length > 0 || undefined} />
        <p id="new-password-guidance" className="text-sm text-muted-foreground">Use at least 15 characters and at most 72 bytes. Some characters, such as emoji, use more than one byte. Try a unique passphrase; common passwords are rejected. No special mix of letters, numbers, or symbols is required.</p>
      </div>
      <div className="grid gap-2"><Label htmlFor="confirm-password">Confirm new password</Label>
        <PasswordInput id="confirm-password" autoComplete="new-password" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} aria-describedby={errors.length ? 'password-update-errors' : undefined} />
      </div>
      <Button size="lg" disabled={pending}>{pending ? 'Saving…' : change ? 'Change password' : 'Reset password'}</Button>
    </form>}
    <Link to="/forgot-password" className="mt-4 inline-flex min-h-11 items-center text-sm underline underline-offset-4">Request another reset email</Link>
  </AuthPageShell>
}

/** Public success survives the authenticated route unmount and subsequent session bootstrap. */
export function PasswordUpdatedPage() {
  const { user } = useAuth()
  return <AuthPageShell title="Password updated" description="This account is signed out everywhere. Sign in with the new password."
    footer={<Link to="/sign-in" className="underline underline-offset-4">Return to sign in</Link>}>
    <p role="status">Your password has been updated.</p>
    {user && <Link to="/library" className="inline-flex min-h-11 items-center underline underline-offset-4">Continue with your signed-in account</Link>}
  </AuthPageShell>
}
