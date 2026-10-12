/**
 * Description: Human-readable labels for persisted interview practice scopes.
 * Index: interviewSetTypeLabel
 */
import type { InterviewQuestionSetTypeEnum } from '@/graphql/generated/graphql'

/** Labels each saved scope consistently in list and detail views. */
export function interviewSetTypeLabel(setType: InterviewQuestionSetTypeEnum): string {
  return { GENERAL: 'General', TECHNICAL: 'Technical', KNOWLEDGE: 'Knowledge' }[setType]
}
