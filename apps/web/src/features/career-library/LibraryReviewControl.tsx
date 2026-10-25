/** Gives each narrative section a visible review action and explains its scope.
 * Reviews assess saved text; individual revision controls handle editing separately.
 */
import { ClipboardCheck, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  section: string
  description: string
  busy: boolean
  disabled: boolean
  onReview: () => void
}

export function LibraryReviewControl({ section, description, busy, disabled, onReview }: Props) {
  const Icon = busy ? LoaderCircle : ClipboardCheck
  return <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
    <Button type="button" variant="secondary" size="sm" disabled={busy || disabled} onClick={onReview}>
      <Icon aria-hidden="true" className={busy ? 'animate-spin' : undefined} />
      {busy ? 'Reviewing…' : `Review ${section}`}
    </Button>
    {(busy || description) && <p className="basis-48 grow text-sm text-muted-foreground" role={busy ? 'status' : undefined}>
      {busy ? 'Checking this section. You can keep browsing your library.' : description}
    </p>}
  </div>
}
