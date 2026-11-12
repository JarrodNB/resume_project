/** Public confirmation after an account is deleted; it survives the signed-in routes unmounting. */
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { AuthPageShell } from '@/features/auth/AuthPageShell'

export function AccountDeletedPage() {
  return <AuthPageShell title="Account deleted" description="Your account and its saved data are gone."
    footer={<Link to="/privacy" className="underline underline-offset-4">How we handle deleted data</Link>}>
    <p role="status">Thanks for trying us. You’ve been signed out on every device.</p>
    <Button asChild size="lg" variant="outline" className="mt-6 min-h-11 w-full"><Link to="/sign-in">Back to sign in</Link></Button>
  </AuthPageShell>
}
