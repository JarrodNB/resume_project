/** The live room's remembered microphone controls. Setup shows the same preferences in InterviewAnswerSettings.
 * Changing preferences never requests microphone access or starts capture. Hands-free mode only works
 * with live transcription, so the switch and its silence length are disabled in recorded mode while the
 * saved choices are kept.
 */
import { HANDS_FREE_NEEDS_LIVE_TRANSCRIPTION, handsFreeAvailable } from './transcriptionHelp'
import type { TranscriptionMode } from './transcriptionCapture'
import { SILENCE_LENGTH_OPTIONS, type useInterviewMicSettings } from './useInterviewMicSettings'

export function InterviewMicrophoneSettings({ microphone, mode }: { microphone: ReturnType<typeof useInterviewMicSettings>; mode: TranscriptionMode }) {
  const liveTranscription = handsFreeAvailable(mode)
  return <div className="grid gap-4">
    <label className="flex min-h-11 items-center justify-between gap-4 text-sm" htmlFor="interview-auto-mic">
      Turn the microphone on automatically
      <input id="interview-auto-mic" type="checkbox" role="switch" className="size-5 shrink-0 accent-primary" checked={microphone.automatic} onChange={(event) => microphone.update({ automatic: event.target.checked })} />
    </label>
    <p className="text-sm leading-relaxed text-muted-foreground">On: listening starts after each question finishes playing. Off: tap the mic for each answer. You can always type instead.</p>
    <label className="grid gap-2 text-sm" htmlFor="interview-thinking-time">Thinking time before the mic opens
      <select id="interview-thinking-time" className="min-h-11 rounded-md border bg-background px-3 py-2" value={microphone.seconds} disabled={!microphone.automatic} onChange={(event) => microphone.update({ seconds: Number(event.target.value) })}>
        <option value={0}>Off</option><option value={3}>3 seconds</option><option value={5}>5 seconds</option><option value={10}>10 seconds</option>
      </select>
    </label>
    <p className="text-sm leading-relaxed text-muted-foreground">Take a short beat to think before speaking. Tap the mic to start sooner. Microphone access is requested only when an answer starts.</p>
    <label className="flex min-h-11 items-center justify-between gap-4 text-sm" htmlFor="interview-hands-free">
      Hands-free mode
      <input id="interview-hands-free" type="checkbox" role="switch" aria-describedby="interview-hands-free-help" className="size-5 shrink-0 accent-primary" checked={microphone.handsFree} disabled={!liveTranscription} onChange={(event) => microphone.update({ handsFree: event.target.checked })} />
    </label>
    <p id="interview-hands-free-help" className="text-sm leading-relaxed text-muted-foreground">{liveTranscription ? 'When you stop talking, your answer is sent after a short countdown. You can keep editing instead. Turning this on also turns on the automatic microphone.' : HANDS_FREE_NEEDS_LIVE_TRANSCRIPTION}</p>
    <label className="grid gap-2 text-sm" htmlFor="interview-silence-length">Silence before your answer ends
      <select id="interview-silence-length" className="min-h-11 rounded-md border bg-background px-3 py-2" value={microphone.silenceSeconds} disabled={!liveTranscription || !microphone.handsFree} onChange={(event) => microphone.update({ silenceSeconds: Number(event.target.value) })}>
        {SILENCE_LENGTH_OPTIONS.map((option) => <option key={option.seconds} value={option.seconds}>{option.name} ({option.seconds} seconds)</option>)}
      </select>
    </label>
    <p className="text-sm leading-relaxed text-muted-foreground">In hands-free mode, how long you stay quiet before your answer ends. Choose Patient if you pause to think.</p>
  </div>
}
