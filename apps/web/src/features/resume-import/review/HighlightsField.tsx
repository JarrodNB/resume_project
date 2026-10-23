/** Edit one role or shared highlight list and drag bullets to another named list.
 * Forty highlights fit in each scope; the form applies draft-only moves and cancellation.
 */
import { Plus, X } from 'lucide-react'
import { SortableGroup } from '@/components/dnd/SortableGroup'
import { SortableItem } from '@/components/dnd/SortableItem'
import { sortableGroupId, sortableId } from '@/components/dnd/moveItems'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { BULLET_TEXT } from '@/lib/textLimits'
import { withDraftKey, type DraftHighlight } from './reviewDraft'
import { HIGHLIGHT_TYPE } from './useReviewDragHandlers'

interface HighlightsFieldProps {
  /** Key of the role these highlights belong to. */
  experienceKey: string
  label?: string
  highlights: DraftHighlight[]
  onChange: (highlights: DraftHighlight[]) => void
}

/** Lets the user edit, remove, add, and drag the highlights of a role. */
export function HighlightsField({ experienceKey, label = 'Highlights', highlights, onChange }: HighlightsFieldProps) {
  const replaceTextAt = (index: number, text: string) =>
    onChange(highlights.map((highlight, position) => (position === index ? { ...highlight, text } : highlight)))
  const removeAt = (index: number) => onChange(highlights.filter((_, position) => position !== index))

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <SortableGroup id={sortableGroupId('highlights', experienceKey)} accept={HIGHLIGHT_TYPE} className="grid min-h-10 gap-2">
        {highlights.length === 0 && (
          <p className="rounded-md border border-dashed p-2 text-sm text-muted-foreground">Drop a highlight here, or add one.</p>
        )}
        {highlights.map((highlight, index) => (
          <SortableItem
            key={highlight.key}
            id={sortableId(HIGHLIGHT_TYPE, highlight.key)}
            index={index}
            type={HIGHLIGHT_TYPE}
            group={sortableGroupId('highlights', experienceKey)}
            label={`highlight ${index + 1}`}
            className="flex items-start gap-1 rounded-md bg-card"
          >
            {(dragHandle) => (
              <>
                <span className="pt-1.5">{dragHandle}</span>
                <Textarea
                  aria-label={`${label} ${index + 1}`}
                  rows={2}
                  maxLength={BULLET_TEXT}
                  value={highlight.text}
                  onChange={(event) => replaceTextAt(index, event.target.value)}
                />
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${label} ${index + 1}`} onClick={() => removeAt(index)}>
                  <X />
                </Button>
              </>
            )}
          </SortableItem>
        ))}
      </SortableGroup>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="justify-self-start"
        disabled={highlights.length >= 40}
        onClick={() => onChange([...highlights, withDraftKey({ text: '' })])}
      >
        <Plus /> Add highlight
      </Button>
    </fieldset>
  )
}
