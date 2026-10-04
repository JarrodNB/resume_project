/**
 * Description: Display text for job application stages.
 * Index:
 *   - JOB_STAGE_LABELS: stage enum -> label
 */
import type { JobsQuery } from '@/graphql/generated/graphql'

type JobStage = JobsQuery['jobs'][number]['stage']

export const JOB_STAGE_LABELS: Record<JobStage, string> = {
  UNAPPLIED: 'Not applied',
  APPLIED: 'Applied',
  INTERVIEWING: 'Interviewing',
  REJECTED: 'Rejected',
  OFFER: 'Offer',
}
