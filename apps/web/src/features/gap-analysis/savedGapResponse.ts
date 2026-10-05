/**
 * Description: A saved answer to one requirement of a job, as returned by Job.gapResponses.
 * Index:
 *   - SavedGapResponse: the answer and, when it was added to the career library, its fact id
 */

export interface SavedGapResponse {
  id: string
  requirement: string
  body: string
  libraryFact: { id: string } | null
}
