/** Plain-language descriptions of each answer transcription mode: full text for the live room, short choices for setup. */
import type { TranscriptionMode } from './transcriptionCapture'

export const TRANSCRIPTION_HELP: Record<TranscriptionMode, string> = {
  browser: 'Browser recognition fills your answer while you speak using your browser’s speech service.',
  streaming: 'Streaming transcription fills your answer while you speak using OpenAI. Try it if browser recognition is unreliable.',
  recorded: 'Recorded audio transcription records first. After you finish, choose Transcribe recording to fill your answer for review.',
}

export const SETUP_TRANSCRIPTION_OPTIONS: { value: TranscriptionMode; label: string; description: string }[] = [
  { value: 'browser', label: 'Browser', description: 'Fills in as you speak, using your browser’s speech service.' },
  { value: 'streaming', label: 'Streaming', description: 'Fills in as you speak. Try it if Browser misses words.' },
  { value: 'recorded', label: 'Recorded', description: 'Records first. When you finish, choose Transcribe recording.' },
]
