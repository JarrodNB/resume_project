/** Gives each narrative section a visible review action, and a blue working dot while it runs.
 * Reviews assess saved text; individual revision controls handle editing separately.
 */
import { ClipboardCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  section: string
  busy: boolean
  disabled: boolean
  onReview: () => void
}

export function LibraryReviewControl({ section, busy, disabled, onReview }: Props) {
  if (busy) return <span className="library-review-busy" role="status"><span className="signal-dot is-ai" aria-hidden />Reviewing {section}…</span>
  return <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onReview}>
    <ClipboardCheck aria-hidden="true" />
    Review {section}
  </Button>
}
