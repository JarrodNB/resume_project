/** The "Your data" part of the account page: download a copy of everything saved, or delete
 * the account. Links to the privacy policy, which explains what is kept and for how long. */
import { useState } from 'react'
import { Link } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { DeleteAccountDialog } from './DeleteAccountDialog'
import { useAccountExport } from './useAccountExport'

export function AccountDataSection() {
  const { downloadExport, pending, error } = useAccountExport()
  const [deleting, setDeleting] = useState(false)
  return (
    <section aria-labelledby="account-data-title" className="security-password-section account-data-section">
      <h2 id="account-data-title" className="mb-2 text-xl font-semibold tracking-tight">Your data</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        See what we keep and for how long in the <Link to="/privacy" className="underline underline-offset-4">privacy policy</Link>.
      </p>
      <div className="grid gap-3">
        <h3 className="font-medium">Download your data</h3>
        <p className="text-sm text-muted-foreground">A JSON file with your profile, career library, jobs, resumes, chats and interview practice.</p>
        {error && <ErrorAlert messages={[error]} />}
        <Button variant="outline" size="lg" className="min-h-11 w-fit" disabled={pending} onClick={() => void downloadExport()}>
          {pending ? 'Preparing…' : 'Download my data'}
        </Button>
      </div>
      <div className="account-delete-block grid gap-3">
        <h3 className="font-medium">Delete your account</h3>
        <p className="text-sm text-muted-foreground">Permanently removes your account and everything in it. This can’t be undone.</p>
        <Button variant="destructive" size="lg" className="min-h-11 w-fit" onClick={() => setDeleting(true)}>Delete account…</Button>
      </div>
      <DeleteAccountDialog open={deleting} onOpenChange={setDeleting} />
    </section>
  )
}
