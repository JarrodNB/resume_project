/** Plain-language descriptions of each answer transcription mode: full text for the live room, short choices for setup,
 * and why hands-free mode is unavailable without live transcription.
 */
import type { TranscriptionMode } from './transcriptionCapture'

export const TRANSCRIPTION_HELP: Record<TranscriptionMode, string> = {
  browser: 'Browser recognition fills your answer while you speak using your browser’s speech service. Your audio is kept as a backup: if recognition stops, choose Transcribe recording to recover your answer.',
  streaming: 'Streaming transcription fills your answer while you speak using OpenAI. Pause recording to finalize the live words, then review and submit. No separate transcription step is needed unless the stream fails.',
  recorded: 'Recorded audio transcription records first. After you finish, choose Transcribe recording to fill your answer for review.',
}

export const SETUP_TRANSCRIPTION_OPTIONS: { value: TranscriptionMode; label: string; description: string }[] = [
  { value: 'browser', label: 'Browser', description: 'Fills in as you speak, using your browser’s speech service.' },
  { value: 'streaming', label: 'Streaming', description: 'Fills in as you speak. Try it if Browser misses words.' },
  { value: 'recorded', label: 'Recorded', description: 'Records first. When you finish, choose Transcribe recording.' },
]

/** Hands-free mode ends answers from live text, so it works only with live transcription modes. */
export function handsFreeAvailable(mode: TranscriptionMode) {
  return mode !== 'recorded'
}

export const HANDS_FREE_NEEDS_LIVE_TRANSCRIPTION = 'Hands-free mode needs live transcription. Choose Browser or Streaming transcription to use it.'
