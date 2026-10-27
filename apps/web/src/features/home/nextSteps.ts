/** How Home shows each suggested next step: its words, how urgent it looks, and which job tab it opens.
 * Rails decides the step (Jobs::BuildPipelineService); this file only presents it.
 */
import type { JobNextStepEnum } from '@/graphql/generated/graphql'

/** running: AI is working. attention: something failed. action: the user's move. quiet: nothing to do yet. */
export type NextStepTone = 'running' | 'attention' | 'action' | 'quiet'

export interface NextStepView { label: string; tone: NextStepTone; tab: string | null }

export const NEXT_STEPS: Record<JobNextStepEnum, NextStepView | null> = {
  COMPARISON_RUNNING: { label: 'Comparing with library', tone: 'running', tab: '' },
  RESUME_RUNNING: { label: 'Writing resume draft', tone: 'running', tab: 'resume' },
  COMPARISON_FAILED: { label: 'Comparison failed', tone: 'attention', tab: '' },
  RESUME_FAILED: { label: 'Resume draft failed', tone: 'attention', tab: 'resume' },
  REVIEW_RESUME_DRAFT: { label: 'Review resume draft', tone: 'action', tab: 'resume' },
  COMPARE: { label: 'Compare with library', tone: 'action', tab: '' },
  WRITE_RESUME: { label: 'Write resume', tone: 'action', tab: 'resume' },
  READY_TO_APPLY: { label: 'Ready to apply', tone: 'action', tab: 'posting' },
  AWAITING_RESPONSE: { label: 'Waiting to hear back', tone: 'quiet', tab: null },
  PRACTICE_INTERVIEW: { label: 'Practise interview', tone: 'action', tab: 'interview' },
  NONE: null,
}

/** The job page that handles a step: `/jobs/:id` for the Fit tab, else that tab. */
export function nextStepPath(jobId: string, tab: string) {
  return tab ? `/jobs/${jobId}/${tab}` : `/jobs/${jobId}`
}
