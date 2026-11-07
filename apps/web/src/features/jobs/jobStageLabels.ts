/** Display names and ordering rules for job application stages.
 * Jobs follow the pipeline order, with rejected jobs last and newer jobs first within a stage.
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

/** Orders jobs by pipeline stage (Rejected last), then newest first inside each stage. */
export function sortJobsByStage<T extends { stage: JobStage; createdAt: string }>(jobs: T[]) {
  return [...jobs].sort((a, b) =>
    JOB_STAGE_ORDER.indexOf(a.stage) - JOB_STAGE_ORDER.indexOf(b.stage) || b.createdAt.localeCompare(a.createdAt))
}
