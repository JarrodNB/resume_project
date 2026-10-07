/**
 * Description: The answer written under one gap or partial match: a text box, an option to add
 * it to the career library, and Save. A blank save clears the answer.
 * Index:
 *   - GapResponseForm: form component
 */
import { useId, useState } from 'react'
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
}

/** Lets the user answer one requirement and optionally keep that answer in the career library. */
export function GapResponseForm({ jobId, requirement, response }: GapResponseFormProps) {
  const checkboxId = useId()
  const { save, saving, errors } = useSaveGapResponse(jobId)
  const [body, setBody] = useState(response?.body ?? '')
  const [addToLibrary, setAddToLibrary] = useState(Boolean(response?.libraryFact))
  const [saved, setSaved] = useState(response)

  const trimmed = body.trim()
  const unchanged = trimmed === (saved?.body ?? '') && addToLibrary === Boolean(saved?.libraryFact)
  const nothingToClear = trimmed === '' && !saved

  /** Saves the current text. An empty box removes the stored answer. */
  async function onSave() {
    const stored = await save(requirement, trimmed, addToLibrary)
    if (stored === undefined) return
    setSaved(stored)
    setBody(stored?.body ?? '')
    setAddToLibrary(Boolean(stored?.libraryFact))
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={`${checkboxId}-answer`}>Your response</Label>
      <Textarea
        id={`${checkboxId}-answer`}
        value={body}
        rows={3}
        maxLength={PROSE_TEXT}
        placeholder="For example: I used Kubernetes at Acme for two years."
        onChange={(event) => setBody(event.target.value)}
      />
      <div className="flex items-center gap-2">
        <Checkbox id={checkboxId} checked={addToLibrary} onCheckedChange={(checked) => setAddToLibrary(checked === true)} />
        <Label htmlFor={checkboxId}>Add to career library</Label>
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" disabled={saving || unchanged || nothingToClear} onClick={() => void onSave()}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {saved && <span className="text-sm text-muted-foreground">Saved on this job.</span>}
      </div>
      <ErrorAlert title="Couldn't save that response" messages={errors} />
    </div>
  )
}
