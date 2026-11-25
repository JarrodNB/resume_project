/** Text shown for chat and interview failures whose failure code is `plan_ended`. Rails sends the code, not
 * this text; mutation refusals use `errorCode: PLAN_ENDED` (see `MutationErrorAlert` in features/billing). */
export const PLAN_ENDED_MESSAGE = 'Your free trial has ended. Subscribe to keep using AI features.'
/** The mutation payload `errorCode` for an ended trial. */
export const PLAN_ENDED_ERROR_CODE = 'PLAN_ENDED'
export const PLAN_ENDED_FAILURE_CODE = 'plan_ended'

/** Thrown where a refusal can only travel as an exception (interview mutations and live transcription); its message is PLAN_ENDED_MESSAGE. */
export class PlanEndedError extends Error {
  constructor() { super(PLAN_ENDED_MESSAGE) }
}
