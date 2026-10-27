/** Gives a job workspace tab the job and live comparison that the workspace already loaded. */
import { useOutletContext } from 'react-router'
import type { useGapAnalysis } from '@/features/gap-analysis/useGapAnalysis'
import type { useJob } from './useJobs'

export interface JobWorkspaceContext {
  job: NonNullable<ReturnType<typeof useJob>['job']>
  comparison: ReturnType<typeof useGapAnalysis>
}

/** The loaded job and its shared comparison, for a tab rendered inside `JobWorkspaceLayout`. */
export function useJobWorkspace() {
  return useOutletContext<JobWorkspaceContext>()
}
