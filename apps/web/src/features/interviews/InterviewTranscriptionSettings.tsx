/** Explains and lets the candidate pick how spoken answers are turned into text.
 * Used on the setup settings step; the live room keeps its own copy because switching there
 * must also discard any recording in progress. The choice is remembered per account.
 */
import type { TranscriptionMode } from './transcriptionCapture'
import { TRANSCRIPTION_HELP } from './transcriptionHelp'

export function InterviewTranscriptionSettings({ mode, change }: { mode: TranscriptionMode; change: (mode: TranscriptionMode) => void }) {
  return <div className="grid gap-2">
    <label className="grid max-w-md gap-2 text-sm" htmlFor="interview-setup-transcription-mode">Answer transcription
      <select id="interview-setup-transcription-mode" aria-describedby="interview-setup-transcription-help" className="min-h-11 rounded-md border bg-background px-3 py-2" value={mode} onChange={(event) => change(event.target.value as TranscriptionMode)}>
        <option value="browser">Browser recognition</option><option value="streaming">Streaming transcription</option><option value="recorded">Recorded audio transcription</option>
      </select>
    </label>
    <p id="interview-setup-transcription-help" className="text-sm leading-relaxed text-muted-foreground">{TRANSCRIPTION_HELP[mode]} If it gives missing or inaccurate words, try another mode. You can always type or correct your answer.</p>
  </div>
}
