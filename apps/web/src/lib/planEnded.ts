/** The refusal text Rails sends when an AI action is blocked because the free trial ended
 * (`AiUsage::CheckAiTaskAllowanceService::PLAN_ENDED_MESSAGE`). Keep the two in step. Chat and
 * interview operations report the same refusal as the failure code `plan_ended`. */
export const PLAN_ENDED_MESSAGE = 'Your free trial has ended. Subscribe to keep using AI features.'
export const PLAN_ENDED_FAILURE_CODE = 'plan_ended'
