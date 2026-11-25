/** Turns the job pipeline into what Home shows: which jobs need the user next, and how many sit in each stage.
 *
 * Pure functions only. Rails decides each job's next step; this file just picks and orders them
 * so Home stays short no matter how many jobs are saved.
 */
import { JOB_STAGE_ORDER, type JobStage } from '@/features/jobs/jobStageLabels'
import type { JobPipelineQuery } from '@/graphql/generated/graphql'
import { NEXT_STEPS } from './nextSteps'

export type PipelineEntry = JobPipelineQuery['jobPipeline'][number]

/** Jobs furthest along come first: an interview to prepare matters more than a resume to start. */
const URGENCY: JobStage[] = ['INTERVIEWING', 'OFFER', 'APPLIED', 'UNAPPLIED', 'REJECTED']

/** Jobs whose suggested step is the user's move (including retrying a failure), most urgent first. */
export function jobsNeedingYou(entries: PipelineEntry[]) {
  return entries
    .filter((entry) => NEXT_STEPS[entry.nextStep]?.signal === 'action')
    .sort((a, b) => URGENCY.indexOf(a.job.stage) - URGENCY.indexOf(b.job.stage))
}

export function countByStage(entries: PipelineEntry[]) {
  const counts = Object.fromEntries(JOB_STAGE_ORDER.map((stage) => [stage, 0])) as Record<JobStage, number>
  for (const entry of entries) counts[entry.job.stage] += 1
  return counts
}
