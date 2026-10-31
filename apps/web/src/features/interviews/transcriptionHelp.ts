/** Plain-language descriptions of each answer transcription mode, shared by setup and the live room. */
import type { TranscriptionMode } from './transcriptionCapture'

export const TRANSCRIPTION_HELP: Record<TranscriptionMode, string> = {
  browser: 'Browser recognition fills your answer while you speak using your browser’s speech service.',
  streaming: 'Streaming transcription fills your answer while you speak using OpenAI. Try it if browser recognition is unreliable.',
  recorded: 'Recorded audio transcription records first. After you finish, choose Transcribe recording to fill your answer for review.',
}
