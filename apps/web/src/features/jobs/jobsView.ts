/** Remembers whether this browser shows the Jobs page as a list or a board. Falls back to the
 * list (it stays readable with hundreds of jobs) when storage is unavailable; the choice is a
 * convenience, not saved data.
 */
import { productStorageKey } from '@/lib/productName'

export type JobsView = 'list' | 'board'
const JOBS_VIEW_STORAGE_KEY = productStorageKey('jobsView')

export function readJobsView(): JobsView {
  try {
    return localStorage.getItem(JOBS_VIEW_STORAGE_KEY) === 'board' ? 'board' : 'list'
  } catch {
    return 'list'
  }
}

export function rememberJobsView(view: JobsView) {
  try {
    localStorage.setItem(JOBS_VIEW_STORAGE_KEY, view)
  } catch {
    // The toggle still works for this visit.
  }
}
