/**
 * Description: Display text and order for job application stages.
 * Index:
 *   - JOB_STAGE_LABELS: stage enum -> label
 *   - JOB_STAGE_ORDER: stages in the order an application moves (Rejected last, as a branch)
 */
import type { JobsQuery } from '@/graphql/generated/graphql'

export type JobStage = JobsQuery['jobs'][number]['stage']

export const JOB_STAGE_LABELS: Record<JobStage, string> = {
  UNAPPLIED: 'Not applied',
  APPLIED: 'Applied',
  INTERVIEWING: 'Interviewing',
  REJECTED: 'Rejected',
  OFFER: 'Offer',
}

export const JOB_STAGE_ORDER: JobStage[] = ['UNAPPLIED', 'APPLIED', 'INTERVIEWING', 'OFFER', 'REJECTED']
