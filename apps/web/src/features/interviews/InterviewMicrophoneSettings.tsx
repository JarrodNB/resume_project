/** The same remembered microphone controls appear before preparation and in the live room.
 * Changing preferences never requests microphone access or starts capture.
 */
import type { useInterviewMicSettings } from './useInterviewMicSettings'

export function InterviewMicrophoneSettings({ microphone }: { microphone: ReturnType<typeof useInterviewMicSettings> }) {
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
  </div>
}
