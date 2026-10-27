/** How Home shows each suggested next step: its words, how urgent it looks, and which job tab it opens.
 * Rails decides the step (Jobs::BuildPipelineService); this file only presents it.
 */
import type { JobNextStepEnum } from '@/graphql/generated/graphql'

/** The four signal colors, one meaning each, used the same way across the app: action is the
 * user's move (including retrying a failure), ai means AI is working, wait means nothing to do yet. */
export type Signal = 'action' | 'ai' | 'wait' | 'done'

export const SIGNAL_LABELS: Record<Signal, string> = { action: 'Needs you', ai: 'AI working', wait: 'Waiting', done: 'Offer' }

export interface NextStepView { label: string; signal: Signal; tab: string | null }

export const NEXT_STEPS: Record<JobNextStepEnum, NextStepView | null> = {
  COMPARISON_RUNNING: { label: 'Comparing with library', signal: 'ai', tab: '' },
  RESUME_RUNNING: { label: 'Writing resume draft', signal: 'ai', tab: 'resume' },
  COMPARISON_FAILED: { label: 'Comparison failed', signal: 'action', tab: '' },
  RESUME_FAILED: { label: 'Resume draft failed', signal: 'action', tab: 'resume' },
  REVIEW_RESUME_DRAFT: { label: 'Review resume draft', signal: 'action', tab: 'resume' },
  COMPARE: { label: 'Compare with library', signal: 'action', tab: '' },
  WRITE_RESUME: { label: 'Write resume', signal: 'action', tab: 'resume' },
  READY_TO_APPLY: { label: 'Ready to apply', signal: 'action', tab: 'posting' },
  AWAITING_RESPONSE: { label: 'Waiting to hear back', signal: 'wait', tab: null },
  PRACTICE_INTERVIEW: { label: 'Practise interview', signal: 'action', tab: 'interview' },
  NONE: null,
}

/** The job page that handles a step: `/jobs/:id` for the Fit tab, else that tab. */
export function nextStepPath(jobId: string, tab: string) {
  return tab ? `/jobs/${jobId}/${tab}` : `/jobs/${jobId}`
}
