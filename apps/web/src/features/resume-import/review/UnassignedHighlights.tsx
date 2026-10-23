/** Show source bullets that need a human to choose their role.
 * Choices use stable draft keys so equal role titles and reordered entries stay distinct.
 * Discard remains reversible until the review is saved.
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ParsedUnassignedHighlight } from '../parsedResume'
import type { DraftExperience } from './reviewDraft'
import { ReviewSection } from './ReviewSection'

interface Props {
  highlights: ParsedUnassignedHighlight[]
  experiences: DraftExperience[]
  discarded: string[]
  onDiscard: (id: string) => void
  onUndo: (id: string) => void
  onAssign: (item: ParsedUnassignedHighlight, destination: string) => void
}

export function UnassignedHighlights({ highlights, experiences, discarded, onDiscard, onUndo, onAssign }: Props) {
  const [destinations, setDestinations] = useState<Record<string, string>>({})
  if (!highlights.length) return null
  return (
    <ReviewSection tone="experience" title="Needs placement" description="Assign each bullet to an experience or discard it before saving. You can add an experience below.">
      {highlights.map((item, index) => {
        const destination = destinations[item.source_id] ?? ''
        return (
          <div key={item.source_id} className="grid gap-3 border-b py-4">
            <p className="text-sm text-muted-foreground">{item.reason === 'missing_role' ? 'No owning role was identified.' : 'The owning role is unclear.'}</p>
            <p className="whitespace-pre-wrap break-words">{item.text}</p>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">{item.source_context}</p>
            {discarded.includes(item.source_id) ? (
              <Button type="button" variant="outline" onClick={() => onUndo(item.source_id)}>Undo discard bullet {index + 1}</Button>
            ) : (
              <>
                <label className="grid gap-2 text-sm">Destination for bullet {index + 1}
                  <select className="min-h-11 rounded-lg border border-input bg-background px-3" value={destination}
                    onChange={(event) => setDestinations({ ...destinations, [item.source_id]: event.target.value })}>
                    <option value="">Choose an experience</option>
                    {experiences.map((experience, position) => (
                      <option key={experience.key} value={experience.key}>
                        {position + 1}. {experience.title || 'Untitled role'} at {experience.company || 'Unnamed company'} ({experience.start_date || 'Unknown start'} – {experience.is_current ? 'Present' : experience.end_date || 'Unknown end'})
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" disabled={!experiences.some((experience) => experience.key === destination)}
                    onClick={() => onAssign(item, destination)}>Assign bullet {index + 1}</Button>
                  <Button type="button" variant="outline" onClick={() => onDiscard(item.source_id)}>Discard bullet {index + 1}</Button>
                </div>
              </>
            )}
          </div>
        )
      })}
      <p role="status" className="text-sm">{highlights.filter((item) => !discarded.includes(item.source_id)).length} bullets still need placement.</p>
    </ReviewSection>
  )
}
