/**
 * Description: Email/password form used by sign-in and sign-up (sign-up adds a name field).
 * Index:
 *   - AuthForm: controlled form that submits AuthCredentials and shows server errors
 */
import { useState, type FormEvent } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthRequestError, type AuthCredentials } from './authApi'

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
    <form className="grid gap-4" onSubmit={handleSubmit}>
      <ErrorAlert messages={errors} />
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
        <Input
          id="password"
          type="password"
          autoComplete={includeName ? 'new-password' : 'current-password'}
          minLength={includeName ? 6 : undefined}
          maxLength={includeName ? 128 : undefined}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {includeName && <p className="text-sm text-muted-foreground">Use 6 to 128 characters.</p>}
      </div>
      <Button type="submit" size="lg" disabled={submitting}>
        {submitting ? 'Please wait…' : submitLabel}
      </Button>
    </form>
  )
}
