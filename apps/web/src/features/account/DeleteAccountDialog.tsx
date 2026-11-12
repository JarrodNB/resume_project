/** Asks for the current password before permanently deleting the account. On success the
 * browser moves to a public confirmation page and every tab's session is cleared. */
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { PasswordInput } from '@/features/auth/PasswordInput'
import { AuthRequestError, deleteAccountRequest } from '@/features/auth/authApi'
import { useAuth } from '@/features/auth/useAuth'

export function DeleteAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { csrfToken, expireSession } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  function close(next: boolean) {
    if (pending) return
    if (!next) { setPassword(''); setErrors([]) }
    onOpenChange(next)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    setPending(true); setErrors([])
    try {
      await deleteAccountRequest(password, csrfToken)
      setPassword('')
      navigate('/account-deleted', { replace: true })
      expireSession(true)
    } catch (error) {
      if (error instanceof AuthRequestError && error.status === 401) {
        navigate('/sign-in', { replace: true, state: { notice: 'Your session expired. Sign in again to delete your account.' } })
        expireSession(true)
      } else {
        setErrors(error instanceof AuthRequestError ? error.messages : ['Could not reach the server. Try again.'])
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-5" aria-busy={pending}>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This permanently deletes your career library, jobs, resumes, chats, interview practice
              and uploaded files, and signs you out everywhere. It can’t be undone. Download your
              data first if you want a copy.
            </DialogDescription>
          </DialogHeader>
          <ErrorAlert title="Couldn’t delete your account" messages={errors} />
          <div className="grid gap-2">
            <Label htmlFor="delete-account-password">Current password</Label>
            <PasswordInput id="delete-account-password" autoComplete="current-password" required value={password}
              disabled={pending} onChange={(event) => setPassword(event.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => close(false)}>Cancel</Button>
            <Button type="submit" variant="destructive" disabled={pending || !password}>{pending ? 'Deleting…' : 'Delete account'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
