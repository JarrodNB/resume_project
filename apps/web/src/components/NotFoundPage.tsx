/** The "page not found" screen for unknown URLs, shown inside the signed-in layout with a link home. */
import { Link } from 'react-router'
import { PageHeading } from '@/components/PageHeading'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  return <div className="grid justify-items-start gap-4">
    <PageHeading title="Page not found" description="That address does not match anything here. It may have moved or been typed wrong." />
    <Button asChild><Link to="/">Go to Home</Link></Button>
  </div>
}
