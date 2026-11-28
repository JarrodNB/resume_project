/** Interview failure codes become plain messages; a raw code never shows. */
import { expect, it } from 'vitest'
import { PLAN_ENDED_MESSAGE } from '@/lib/planEnded'
import { interviewFailureMessage } from './interviewFailureMessage'

it('uses a step-specific message before the shared one', () => {
  expect(interviewFailureMessage('turn', 'empty_audio')).toBe('No speech was heard in this recording. Record your answer again.')
  expect(interviewFailureMessage('preparation', 'dependency_unavailable')).toBe('The AI service is unavailable right now. Try again shortly.')
  expect(interviewFailureMessage('speech', 'plan_ended')).toBe(PLAN_ENDED_MESSAGE)
})

it('falls back to a general message for an unknown or missing code', () => {
  expect(interviewFailureMessage('preparation', 'provider_error')).toBe('Careerdrafter could not prepare your interview.')
  expect(interviewFailureMessage('turn', null)).toBe('Careerdrafter could not process your answer.')
})
