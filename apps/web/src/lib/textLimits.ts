/**
 * Description: Character caps for user-written text. They match Rails `TextLimits` so a form
 * stops at the same length the API rejects.
 * Index:
 *   - SHORT_TEXT: names, titles, companies, skills, and URLs
 *   - BULLET_TEXT: one highlight or job requirement
 *   - PROSE_TEXT: a description, summary, or answer
 *   - JOB_DESCRIPTION_TEXT: a job description
 *   - INTERVIEW_ANSWER_TEXT: a typed interview practice answer
 *   - MAX_LINKS: links on a profile
 */
export const SHORT_TEXT = 200
export const BULLET_TEXT = 1000
export const PROSE_TEXT = 4000
export const JOB_DESCRIPTION_TEXT = 20_000
export const INTERVIEW_ANSWER_TEXT = 1_000
export const MAX_LINKS = 20
