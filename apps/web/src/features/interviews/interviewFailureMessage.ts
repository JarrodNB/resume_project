/** Plain-language messages for a failed interview step (preparation, speech or an answer),
 * keyed by the operation's failure code from Rails. An unknown or missing code gets a general
 * message, so a raw code never reaches the screen.
 */
import { PLAN_ENDED_FAILURE_CODE, PLAN_ENDED_MESSAGE } from '@/lib/planEnded'

export type InterviewStep = 'preparation' | 'speech' | 'turn'

const sharedMessages: Record<string, string> = {
  dependency_unavailable: 'The AI service is unavailable right now. Try again shortly.',
  screening_unavailable: 'The input check is unavailable right now. Try again shortly.',
  execution_timeout: 'This took too long to finish. Try again.',
  lease_expired: 'This was interrupted before it finished. Try again.',
  storage_unavailable: 'Saved audio is unavailable right now. Try again shortly.',
  ai_usage_limit_reached: "You've reached today's usage limit. Try again tomorrow.",
  [PLAN_ENDED_FAILURE_CODE]: PLAN_ENDED_MESSAGE,
}

const stepMessages: Record<InterviewStep, Record<string, string>> = {
  preparation: {
    context_limit: 'Your career details are too long to prepare this interview. Shorten them and start a new interview.',
    screening_blocked: 'Your career details or this job could not pass the input check. Check them and start a new interview.',
  },
  speech: {},
  turn: {
    invalid_recording: 'This recording could not be read. Record your answer again.',
    empty_audio: 'No speech was heard in this recording. Record your answer again.',
    audio_too_large: 'This recording is too large. Record a shorter answer.',
    audio_too_long: 'This recording is too long. Record a shorter answer.',
    transcript_too_long: 'This answer is too long. Give a shorter answer.',
    context_limit: 'This interview is too long to continue. Finish it or start a new interview.',
    screening_blocked: 'This answer could not pass the input check. Rephrase it and try again.',
  },
}

const fallbackMessages: Record<InterviewStep, string> = {
  preparation: 'Careerdrafter could not prepare your interview.',
  speech: "Careerdrafter could not play the interviewer's voice. Saved dialogue is unchanged.",
  turn: 'Careerdrafter could not process your answer.',
}

export const interviewFailureTitles: Record<InterviewStep, string> = {
  preparation: "Couldn't prepare your interview",
  speech: "Couldn't play the interviewer",
  turn: "Couldn't process your answer",
}

/** The message for a failed interview step; never the raw code. */
export function interviewFailureMessage(step: InterviewStep, code: string | null | undefined) {
  return stepMessages[step][code ?? ''] ?? sharedMessages[code ?? ''] ?? fallbackMessages[step]
}
