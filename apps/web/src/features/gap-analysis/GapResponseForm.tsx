/**
 * Collects the real details the resume writer can use for one gap or partial match: a text box,
 * an option to add them to the career library, and Save. A blank save clears the saved details.
 * The caller's dismiss action only shows while the box is empty, so typed text is never thrown away.
 */
import { useId, useState, type ReactNode } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PROSE_TEXT } from '@/lib/textLimits'
import type { SavedGapResponse } from './savedGapResponse'
import { useSaveGapResponse } from './useSaveGapResponse'

interface GapResponseFormProps {
  jobId: string
  requirement: string
  response: SavedGapResponse | null
  dismissAction?: ReactNode
  onSaved?: () => void
}

/** Lets the user write details for one requirement and optionally keep them in the career library. */
export function GapResponseForm({ jobId, requirement, response, dismissAction, onSaved }: GapResponseFormProps) {
  const id = useId()
  const { save, saving, errors } = useSaveGapResponse(jobId)
  const [body, setBody] = useState(response?.body ?? '')
  const [addToLibrary, setAddToLibrary] = useState(Boolean(response?.careerContext))
  const [saved, setSaved] = useState(response)

  const trimmed = body.trim()
  const unchanged = trimmed === (saved?.body ?? '') && addToLibrary === Boolean(saved?.careerContext)
  const nothingToClear = trimmed === '' && !saved

  /** Saves the current text. An empty box removes the stored details. */
  async function onSave() {
    const stored = await save(requirement, trimmed, addToLibrary)
    if (stored === undefined) return
    setSaved(stored)
    setBody(stored?.body ?? '')
    setAddToLibrary(Boolean(stored?.careerContext))
    onSaved?.()
  }

  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={`${id}-details`}>Details for your resume</Label>
      <p id={`${id}-help`} className="text-sm text-muted-foreground">
        Say what you did, where, and the result. Only include what's true.
      </p>
      <Textarea
        id={`${id}-details`}
        aria-describedby={`${id}-help`}
        value={body}
        rows={3}
        maxLength={PROSE_TEXT}
        placeholder="For example: Led a team of 4 at Acme and cut onboarding time from 6 weeks to 3."
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="flex items-center gap-2">
        <Checkbox id={id} checked={addToLibrary} onCheckedChange={(checked) => setAddToLibrary(checked === true)} />
        <Label htmlFor={id}>Add to career library</Label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" disabled={saving || unchanged || nothingToClear} onClick={() => void onSave()}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {trimmed === '' && !saved && dismissAction}
        {saved && <span className="text-sm text-muted-foreground">Saved on this job. Resume drafts for this job can use it.</span>}
      </div>
      <ErrorAlert title="Couldn't save those details" messages={errors} />
    </div>
  )
}
