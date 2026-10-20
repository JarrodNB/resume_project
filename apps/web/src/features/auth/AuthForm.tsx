/**
 * Collects login or signup credentials and shows server errors. Signup explains
 * the server's new-password policy; login leaves existing passwords unrestricted.
 */
import { useState, type FormEvent } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthRequestError, type AuthCredentials } from './authApi'
import { PasswordInput } from './PasswordInput'
import { PasswordGuidance } from './PasswordGuidance'

interface AuthFormProps {
  submitLabel: string
  includeName?: boolean
  onSubmit: (credentials: AuthCredentials) => Promise<void>
}

/** Collects credentials, calls `onSubmit`, and lists any errors it throws. */
export function AuthForm({ submitLabel, includeName = false, onSubmit }: AuthFormProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setErrors([])
    try {
      await onSubmit(includeName ? { name, email, password } : { email, password })
    } catch (error) {
      setErrors(error instanceof AuthRequestError ? error.messages : ['Could not reach the server.'])
      setSubmitting(false)
    }
  }

  return (
    <form className="grid gap-4" onSubmit={handleSubmit} aria-busy={submitting}>
      {errors.length > 0 && <div id="auth-errors"><ErrorAlert messages={errors} /></div>}
      {includeName && (
        <div className="grid gap-2">
          <Label htmlFor="name">Name <span className="text-muted-foreground">(optional)</span></Label>
          <Input id="name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
      )}
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">Password</Label>
        <PasswordInput
          id="password"
          autoComplete={includeName ? 'new-password' : 'current-password'}
          aria-describedby={[includeName && 'password-guidance', errors.length > 0 && 'auth-errors'].filter(Boolean).join(' ') || undefined}
          aria-invalid={errors.some((message) => /^password\b/i.test(message)) || undefined}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {includeName && (
          <PasswordGuidance id="password-guidance" />
        )}
      </div>
      <Button type="submit" size="lg" disabled={submitting}>
        {submitting ? 'Please wait…' : submitLabel}
      </Button>
    </form>
  )
}
