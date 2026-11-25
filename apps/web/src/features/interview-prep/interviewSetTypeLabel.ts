/**
 * Description: Human-readable labels for persisted interview practice scopes.
 * Index: interviewSetTypeLabel
 */
import type { InterviewQuestionSetTypeEnum } from '@/graphql/generated/graphql'

export const QUESTION_TYPES: InterviewQuestionSetTypeEnum[] = ['FIT_MOTIVATION', 'BEHAVIORAL', 'HYPOTHETICAL', 'TECHNICAL', 'KNOWLEDGE']

/** Labels each saved scope consistently in list and detail views. */
export function interviewSetTypeLabel(setType: InterviewQuestionSetTypeEnum): string {
  return { FIT_MOTIVATION: 'Fit & motivation', BEHAVIORAL: 'Behavioral', HYPOTHETICAL: 'Hypothetical', TECHNICAL: 'Technical', KNOWLEDGE: 'Knowledge' }[setType]
}
