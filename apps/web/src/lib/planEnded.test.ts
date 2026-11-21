import { expect, it } from 'vitest'
import { PLAN_ENDED_FAILURE_CODE, PLAN_ENDED_MESSAGE } from './planEnded'

// Rails sends this exact text and the web app matches it to show the subscribe link.
// services/api/spec/services/ai_usage/check_ai_task_allowance_service_spec.rb pins the same literal. Change both together.
it('matches the refusal text Rails sends when the plan has ended', () => {
  expect(PLAN_ENDED_MESSAGE).toBe('Your free trial has ended. Subscribe to keep using AI features.')
  expect(PLAN_ENDED_FAILURE_CODE).toBe('plan_ended')
})
