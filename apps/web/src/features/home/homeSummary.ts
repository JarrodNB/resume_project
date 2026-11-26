/** Turns the job pipeline into what Home shows: which jobs need the user next, how many sit in each
 * stage, and whether the user is still on the first-run guide.
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

/** Whether the user is past the first-run guide: they have written a tailored resume, or moved a
 * job past "not applied" (someone tracking applications is not new, even without our resumes).
 * `resumeCount` is null while resumes are still loading. */
export function finishedFirstRun(entries: PipelineEntry[], resumeCount: number | null) {
  return (resumeCount ?? 0) > 0 || entries.some((entry) => entry.job.stage !== 'UNAPPLIED')
}
