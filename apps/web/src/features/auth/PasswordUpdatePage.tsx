/** Collects a replacement password for recovery or a signed-in account change.
 * Tokens stay in memory, server validation owns policy, and success refreshes every tab's session. */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ErrorAlert } from '@/components/ErrorAlert'
import { AuthPageShell } from './AuthPageShell'
import { PasswordInput } from './PasswordInput'
import { PasswordGuidance } from './PasswordGuidance'
import { AuthRequestError, changePasswordRequest, resetPasswordRequest } from './authApi'
import { forgetResetPasswordToken, readResetPasswordToken } from './resetPasswordLink'
import { useAuth } from './useAuth'

export function PasswordUpdatePage({ change = false }: { change?: boolean }) {
  const { csrfToken, expireSession, user } = useAuth()
  const navigate = useNavigate()
  const [token] = useState(readResetPasswordToken)
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [pending, setPending] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const errorSummary = useRef<HTMLDivElement>(null)
  useEffect(() => { if (errors.length) errorSummary.current?.focus() }, [errors])
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
  const form = !change && !token ? <p>Open your reset email link again, or request a new one below. Refreshing this page clears the link for your privacy.</p> : <form onSubmit={submit} className="grid gap-5" aria-busy={pending}>
      {errors.length > 0 && <div id="password-update-errors" ref={errorSummary} tabIndex={-1}><ErrorAlert messages={errors} /></div>}
      {change && <div className="grid gap-2"><Label htmlFor="current-password">Current password</Label>
        <PasswordInput id="current-password" autoComplete="current-password" required value={current} onChange={(event) => setCurrent(event.target.value)} aria-describedby={errors.length ? 'password-update-errors' : undefined} aria-invalid={errors.some((message) => /^current password/i.test(message)) || undefined} />
        <Link to="/forgot-password" className="inline-flex min-h-11 w-fit items-center text-sm underline underline-offset-4">Forgot your current password?</Link>
      </div>}
      <div className="grid gap-2"><Label htmlFor="new-password">New password</Label>
        <PasswordInput id="new-password" autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} aria-describedby={`new-password-guidance${errors.length ? ' password-update-errors' : ''}`} aria-invalid={errors.length > 0 || undefined} />
        <PasswordGuidance id="new-password-guidance" />
      </div>
      <div className="grid gap-2"><Label htmlFor="confirm-password">Confirm new password</Label>
        <PasswordInput id="confirm-password" autoComplete="new-password" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} aria-describedby={errors.length ? 'password-update-errors' : undefined} aria-invalid={errors.some((message) => /confirmation/i.test(message)) || undefined} />
      </div>
      {change && <p id="password-change-notice" className="security-session-notice">Changing your password signs this account out on every device, including this one. Sign in again with your new password afterward.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" className="min-h-11" disabled={pending} aria-describedby={change ? 'password-change-notice' : undefined}>{pending ? 'Saving…' : change ? 'Change password' : 'Reset password'}</Button>
        {change && <Button asChild variant="ghost" size="lg" className="min-h-11"><Link to="/library" aria-disabled={pending} onClick={(event) => { if (pending) event.preventDefault() }}>Cancel</Link></Button>}
      </div>
    </form>

  if (change) return <div className="account-security-page">
    <header className="mb-8"><h1 className="text-3xl font-semibold tracking-tight">Account security</h1><p className="mt-3 text-muted-foreground">Manage the password you use to sign in.</p></header>
    <div className="security-account-identity"><span className="text-sm text-muted-foreground">Signed in as</span><p className="mt-1 break-words font-medium">{user?.email}</p></div>
    <section aria-labelledby="change-password-title" className="security-password-section">
      <h2 id="change-password-title" className="mb-2 text-xl font-semibold tracking-tight">Change your password</h2>
      <p className="mb-6 text-sm text-muted-foreground">Enter your current password, then choose a new one.</p>
      {form}
    </section>
  </div>

  return <AuthPageShell title="Choose a new password"
    description="A successful change signs this account out everywhere. Sign in again afterward."
    footer={<Link to="/sign-in" className="underline underline-offset-4">Return to sign in</Link>}>
    {form}
    <Link to="/forgot-password" className="mt-4 inline-flex min-h-11 items-center text-sm underline underline-offset-4">Request another reset email</Link>
  </AuthPageShell>
}

/** Public success survives the authenticated route unmount and subsequent session bootstrap. */
export function PasswordUpdatedPage() {
  const { user } = useAuth()
  return <AuthPageShell title="Password updated" description="This account is signed out everywhere. Sign in with the new password."
    footer={user ? <Link to="/library" className="inline-flex min-h-11 items-center underline underline-offset-4">Continue with your signed-in account</Link> : 'Grounded in your experience. Refined with you.'}>
    <p role="status">Your password has been updated.</p>
    <Button asChild size="lg" className="mt-6 min-h-11 w-full"><Link to="/sign-in">Sign in with new password</Link></Button>
  </AuthPageShell>
}
