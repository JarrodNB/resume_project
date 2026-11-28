/** Live captions for both sides of a live interview, with a button to hide or show them.
 * Captions come from the live room hook; each line is replaced as its speech is refined.
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { LiveCaption } from './useLiveInterviewRoom'

export function LiveCaptions({ captions }: { captions: LiveCaption[] }) {
  const [shown, setShown] = useState(true)
  return <div className="grid gap-2 text-left">
    <Button variant="ghost" className="min-h-11 justify-self-start" onClick={() => setShown(!shown)}>{shown ? 'Hide captions' : 'Show captions'}</Button>
    {shown && <div role="log" aria-label="Captions" aria-live="polite" className="grid max-h-64 gap-2 overflow-y-auto rounded-md border p-3 text-sm">
      {captions.length === 0 && <p className="text-muted-foreground">Captions appear here as you and your interviewer speak.</p>}
      {captions.map((caption) => <p key={caption.id}>
        <span className="font-medium">{caption.speaker === 'interviewer' ? 'Interviewer' : 'You'}:</span> {caption.text}
      </p>)}
    </div>}
  </div>
}
