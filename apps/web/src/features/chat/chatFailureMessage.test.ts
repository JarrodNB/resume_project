import { expect, it } from 'vitest'
import { chatFailureMessage } from './useChatTurn'

it('tells the user to try again tomorrow at the daily limit, without any amounts', () => {
  expect(chatFailureMessage('ai_usage_limit_reached')).toBe("You've reached today's usage limit. Try again tomorrow.")
})

it('tells the user to subscribe once the trial has ended', () => {
  expect(chatFailureMessage('plan_ended')).toBe('Your free trial has ended. Subscribe to keep using AI features.')
})

it('falls back to a retry message for unknown codes', () => {
  expect(chatFailureMessage(null)).toMatch(/try again/)
})
