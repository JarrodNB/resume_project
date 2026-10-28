/**
 * Description: A saved answer to one requirement of a job, as returned by Job.gapResponses.
 * Index:
 *   - SavedGapResponse: the answer and, when it was added to the career library, its context id
 */

export interface SavedGapResponse {
  id: string
  requirement: string
  body: string
  careerContext: { id: string } | null
}
